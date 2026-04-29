/**
 * Explorador del esquema de Aware para encontrar la tabla de digitación.
 *
 * Uso: node scripts/discover-digitacion.js [AWARE_HOST]
 * Ejemplo: node scripts/discover-digitacion.js 10.255.255.30
 *
 * Lo que hace:
 * 1. Conecta al PostgreSQL del servidor Aware indicado vía túnel SSH por Kraken
 * 2. Lista TODAS las tablas del schema public
 * 3. Para cada tabla que parezca candidata (por nombre o columnas), muestra su estructura
 * 4. Muestra datos de muestra de las tablas candidatas
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { Client: SSHClient } = require('ssh2');
const { Client: PGClient } = require('pg');
const net = require('net');
const fs = require('fs');
const config = require('../src/config');

const TARGET_HOST = process.argv[2] || '10.255.255.30';
const TARGET_PORT = 5432;
const DB_NAME = 'aware';

// Palabras clave que sugieren tabla de digitación / tipificación
const CANDIDATE_KEYWORDS = [
  'digit', 'tipif', 'gestion', 'gestión', 'nota', 'observ',
  'comentar', 'result', 'disposition', 'motivo', 'cierre',
  'accion', 'acción', 'registro_tip', 'llamada_tip', 'encuesta',
  'seguimiento', 'contacto', 'resumen',
];

function openTunnel() {
  return new Promise((resolve, reject) => {
    const ssh = new SSHClient();
    const sshCfg = {
      host: config.aware.ssh.host,
      port: config.aware.ssh.port,
      username: config.aware.ssh.username,
    };
    if (config.aware.ssh.privateKey) {
      sshCfg.privateKey = fs.readFileSync(config.aware.ssh.privateKey);
    } else if (config.aware.ssh.password) {
      sshCfg.password = config.aware.ssh.password;
    }

    ssh.on('ready', () => {
      const server = net.createServer((socket) => {
        ssh.forwardOut('127.0.0.1', 0, TARGET_HOST, TARGET_PORT, (err, stream) => {
          if (err) { socket.end(); return; }
          socket.pipe(stream).pipe(socket);
        });
      });
      server.listen(0, '127.0.0.1', () => {
        resolve({ ssh, server, port: server.address().port });
      });
      server.on('error', reject);
    });
    ssh.on('error', reject);
    ssh.connect(sshCfg);
  });
}

function isCandidate(tableName) {
  const lower = tableName.toLowerCase();
  return CANDIDATE_KEYWORDS.some((kw) => lower.includes(kw));
}

async function main() {
  const group1User = process.env.AWARE_DB_USER_GROUP1 || 'analista';
  const group1Pass = process.env.AWARE_DB_PASS_GROUP1 || '';

  console.log(`\n${'='.repeat(60)}`);
  console.log(`EXPLORADOR DE ESQUEMA AWARE`);
  console.log(`Host destino: ${TARGET_HOST}:${TARGET_PORT}`);
  console.log(`Base de datos: ${DB_NAME}`);
  console.log(`SSH via Kraken: ${config.aware.ssh.host}`);
  console.log('='.repeat(60));

  console.log('\nAbriendo túnel SSH a través de Kraken...');
  const { ssh, server, port } = await openTunnel();
  console.log(`Túnel abierto en localhost:${port}\n`);

  const pg = new PGClient({
    host: '127.0.0.1',
    port,
    database: DB_NAME,
    user: group1User,
    password: group1Pass,
    statement_timeout: 30000,
  });

  try {
    await pg.connect();
    console.log('Conectado a PostgreSQL\n');

    // 1. Listar todas las tablas del schema public
    const tablesRes = await pg.query(`
      SELECT table_name,
             pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) AS size,
             (SELECT COUNT(*) FROM information_schema.columns c
              WHERE c.table_schema = 'public' AND c.table_name = t.table_name) AS col_count
      FROM information_schema.tables t
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    console.log(`TODAS LAS TABLAS (${tablesRes.rows.length} total):`);
    console.log('-'.repeat(50));
    const candidates = [];
    for (const row of tablesRes.rows) {
      const flag = isCandidate(row.table_name) ? ' ◄ CANDIDATA' : '';
      console.log(`  ${row.table_name.padEnd(40)} cols:${row.col_count}  ${row.size}${flag}`);
      if (isCandidate(row.table_name)) candidates.push(row.table_name);
    }

    // 2. Para cada tabla candidata, mostrar columnas y muestra de datos
    console.log(`\n${'='.repeat(60)}`);
    console.log(`DETALLE DE TABLAS CANDIDATAS (${candidates.length})`);
    console.log('='.repeat(60));

    for (const tableName of candidates) {
      console.log(`\n--- TABLA: ${tableName} ---`);

      // Columnas
      const colRes = await pg.query(`
        SELECT column_name, data_type, character_maximum_length, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [tableName]);

      console.log('  Columnas:');
      for (const col of colRes.rows) {
        const type = col.character_maximum_length
          ? `${col.data_type}(${col.character_maximum_length})`
          : col.data_type;
        console.log(`    ${col.column_name.padEnd(35)} ${type.padEnd(20)} nullable:${col.is_nullable}`);
      }

      // Conteo de filas
      try {
        const countRes = await pg.query(`SELECT COUNT(*) AS total FROM ${tableName}`);
        console.log(`  Total filas: ${countRes.rows[0].total}`);

        // Muestra de datos si tiene filas
        if (parseInt(countRes.rows[0].total) > 0) {
          const sampleRes = await pg.query(`SELECT * FROM ${tableName} LIMIT 2`);
          console.log('  Muestra (2 filas):');
          for (const row of sampleRes.rows) {
            const preview = Object.entries(row)
              .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
              .join(' | ');
            console.log(`    ${preview.substring(0, 200)}${preview.length > 200 ? '...' : ''}`);
          }
        }
      } catch (e) {
        console.log(`  (no se pudo contar: ${e.message})`);
      }
    }

    // 3. Buscar tablas que tienen columna call_id o registro_llamada_id (independiente del nombre)
    console.log(`\n${'='.repeat(60)}`);
    console.log('TABLAS CON COLUMNA call_id O registro_llamada_id:');
    console.log('='.repeat(60));
    const fkRes = await pg.query(`
      SELECT DISTINCT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name IN ('call_id', 'registro_llamada_id', 'llamada_id', 'id_llamada', 'id_registro')
      ORDER BY table_name, column_name
    `);
    if (fkRes.rows.length === 0) {
      console.log('  Ninguna (aparte de registro_llamada)');
    } else {
      for (const row of fkRes.rows) {
        const alreadySeen = candidates.includes(row.table_name);
        console.log(`  ${row.table_name.padEnd(40)} columna: ${row.column_name}${alreadySeen ? ' (ya mostrada arriba)' : ' ◄ NUEVA'}`);
      }
    }

    // 4. Tablas que tienen columna con texto libre (text/varchar larga)
    console.log(`\n${'='.repeat(60)}`);
    console.log('TABLAS CON COLUMNAS DE TEXTO LIBRE (text o varchar > 100):');
    console.log('='.repeat(60));
    const textRes = await pg.query(`
      SELECT table_name, column_name, data_type, character_maximum_length
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (data_type = 'text' OR character_maximum_length > 100)
        AND table_name NOT IN ('registro_llamada', 'queue_log', 'empleado', 'usuario')
      ORDER BY table_name, column_name
    `);
    const seenTables = new Set();
    for (const row of textRes.rows) {
      const type = row.character_maximum_length
        ? `varchar(${row.character_maximum_length})`
        : row.data_type;
      const prefix = seenTables.has(row.table_name) ? '      ' : `  [${row.table_name}]\n      `;
      console.log(`${prefix}${row.column_name.padEnd(35)} ${type}`);
      seenTables.add(row.table_name);
    }

  } finally {
    await pg.end().catch(() => {});
    server.close();
    ssh.end();
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('Exploración completada');
  console.log('='.repeat(60) + '\n');
}

main().catch((err) => {
  console.error('\nError fatal:', err.message);
  process.exit(1);
});
