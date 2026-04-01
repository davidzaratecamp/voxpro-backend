/**
 * Diagnóstico de AWARE_6 para entender por qué las grabaciones no se enriquecen.
 *
 * Uso: node scripts/diagnose-aware6.js [YYYY-MM-DD]
 * Ejemplo: node scripts/diagnose-aware6.js 2026-03-31
 *
 * Lo que hace:
 * 1. Lee de MySQL los call_ids de grabaciones AWARE_6 para esa fecha
 * 2. Consulta PostgreSQL de AWARE_6 SIN filtro de anexo para esos call_ids
 * 3. Muestra un resumen de anexos disponibles en registro_llamada para esa fecha
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { Client: SSHClient } = require('ssh2');
const { Client: PGClient } = require('pg');
const net = require('net');
const fs = require('fs');
const knex = require('knex');

const config = require('../src/config');
const AWARE_SOURCES = require('../src/config/sources');

const date = process.argv[2] || '2026-03-31';

// Conexión MySQL local
const db = knex({
  client: 'mysql2',
  connection: {
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
  },
});

function openTunnel(dbConfig) {
  return new Promise((resolve, reject) => {
    const ssh = new SSHClient();
    const sshConfig = {
      host: config.aware.ssh.host,
      port: config.aware.ssh.port,
      username: config.aware.ssh.username,
    };
    if (config.aware.ssh.privateKey) {
      sshConfig.privateKey = fs.readFileSync(config.aware.ssh.privateKey);
    } else if (config.aware.ssh.password) {
      sshConfig.password = config.aware.ssh.password;
    }

    ssh.on('ready', () => {
      const server = net.createServer((socket) => {
        ssh.forwardOut('127.0.0.1', 0, dbConfig.host, dbConfig.port, (err, stream) => {
          if (err) { socket.end(); return; }
          socket.pipe(stream).pipe(socket);
        });
      });
      server.listen(0, '127.0.0.1', () => {
        resolve({ ssh, server, port: server.address().port });
      });
    });
    ssh.on('error', reject);
    ssh.connect(sshConfig);
  });
}

async function main() {
  const source6 = AWARE_SOURCES.find((s) => s.folder === 'AWARE_6');
  if (!source6) {
    console.error('No se encontró AWARE_6 en sources.js');
    process.exit(1);
  }

  console.log(`\n=== Diagnóstico AWARE_6 para ${date} ===\n`);

  // 1. Leer call_ids de MySQL para AWARE_6 en esa fecha
  const mysqlRecs = await db('recordings as r')
    .join('aware_sources as s', 'r.aware_source_id', 's.id')
    .where('r.file_date', date)
    .where('s.folder_name', 'AWARE_6')
    .select('r.call_id', 'r.file_name', 'r.agent_enriched', 'r.agent_id')
    .limit(50);

  console.log(`MySQL: ${mysqlRecs.length} grabaciones AWARE_6 para ${date} (mostrando hasta 50)`);
  if (mysqlRecs.length === 0) {
    console.log('  → No hay grabaciones insertadas para AWARE_6 en esa fecha');
    console.log('  → Posible causa: el escaneo no encontró archivos, o la fuente AWARE_6 no está activa en aware_sources');
    await db.destroy();
    return;
  }

  const sample = mysqlRecs.slice(0, 5);
  console.log('\nMuestra de call_ids en MySQL:');
  for (const r of sample) {
    console.log(`  file: ${r.file_name} | call_id: ${r.call_id} | enriched: ${r.agent_enriched} | agent_id: ${r.agent_id || 'null'}`);
  }

  const callIds = mysqlRecs.map((r) => r.call_id).filter(Boolean);
  const numericIds = callIds.filter((id) => /^\d+$/.test(String(id))).map(Number);
  const dotIds = callIds.filter((id) => /^\d+\.\d+$/.test(String(id)));

  console.log(`\nTipos de call_id: ${numericIds.length} numéricos, ${dotIds.length} dot-notation`);

  // 2. Conectar a AWARE_6 via SSH
  console.log('\nConectando a AWARE_6 via SSH tunnel...');
  const { ssh, server, port } = await openTunnel(source6.db);

  const pg = new PGClient({
    host: '127.0.0.1',
    port,
    database: source6.db.database,
    user: source6.db.user,
    password: source6.db.password,
    statement_timeout: 30000,
  });

  try {
    await pg.connect();
    console.log('Conectado a AWARE_6 PostgreSQL\n');

    // 3. ¿Cuántos registros hay en registro_llamada para esa fecha?
    const countRes = await pg.query(
      `SELECT COUNT(*) as total FROM registro_llamada WHERE registro_llamada_fecha = $1::date`,
      [date]
    );
    console.log(`registro_llamada total para ${date}: ${countRes.rows[0].total}`);

    // 4. Distribución de anexos para esa fecha
    const anexoRes = await pg.query(
      `SELECT COALESCE(anexo, 'NULL') as anexo, COUNT(*) as cnt
       FROM registro_llamada
       WHERE registro_llamada_fecha = $1::date
       GROUP BY anexo
       ORDER BY cnt DESC
       LIMIT 20`,
      [date]
    );
    console.log('\nDistribución de anexos en registro_llamada:');
    if (anexoRes.rows.length === 0) {
      console.log('  → Sin registros para esa fecha');
    } else {
      for (const row of anexoRes.rows) {
        const isTarget = ['4002','4007','4012','4016'].includes(row.anexo);
        console.log(`  anexo=${row.anexo.padEnd(10)} count=${row.cnt}${isTarget ? ' ← RECLUTAMIENTO' : ''}`);
      }
    }

    // 5. Buscar los call_ids de MySQL en AWARE_6 SIN filtro de anexo
    if (numericIds.length > 0) {
      const matchRes = await pg.query(
        `SELECT rl.call_id, rl.anexo, rl.agente_id, e.empleado_name
         FROM registro_llamada rl
         LEFT JOIN empleado e ON rl.agente_id = e.empleado_rut
         WHERE rl.call_id = ANY($1::int[])
           AND rl.registro_llamada_fecha = $2::date
         LIMIT 10`,
        [numericIds, date]
      );
      console.log(`\nBúsqueda por call_id numérico (${numericIds.length} ids): ${matchRes.rows.length} matches en AWARE_6 PG`);
      for (const row of matchRes.rows) {
        console.log(`  call_id=${row.call_id} | anexo=${row.anexo} | agente_id=${row.agente_id} | nombre=${row.empleado_name}`);
      }
    }

    if (dotIds.length > 0) {
      const matchRes = await pg.query(
        `SELECT rl.uniqueid, rl.anexo, rl.agente_id, e.empleado_name
         FROM registro_llamada rl
         LEFT JOIN empleado e ON rl.agente_id = e.empleado_rut
         WHERE rl.uniqueid = ANY($1::text[])
           AND rl.registro_llamada_fecha = $2::date
         LIMIT 10`,
        [dotIds, date]
      );
      console.log(`\nBúsqueda por uniqueid dot-notation (${dotIds.length} ids): ${matchRes.rows.length} matches en AWARE_6 PG`);
      for (const row of matchRes.rows) {
        console.log(`  uniqueid=${row.uniqueid} | anexo=${row.anexo} | agente_id=${row.agente_id} | nombre=${row.empleado_name}`);
      }
    }

    // 6. Muestra de registros de registro_llamada para esa fecha (sin filtro)
    const samplePg = await pg.query(
      `SELECT rl.call_id, rl.uniqueid, rl.anexo, rl.agente_id, e.empleado_name, rl.call_time
       FROM registro_llamada rl
       LEFT JOIN empleado e ON rl.agente_id = e.empleado_rut
       WHERE rl.registro_llamada_fecha = $1::date
       LIMIT 5`,
      [date]
    );
    console.log(`\nMuestra de registro_llamada para ${date}:`);
    if (samplePg.rows.length === 0) {
      console.log('  → Sin registros en AWARE_6 para esa fecha');
    } else {
      for (const row of samplePg.rows) {
        console.log(`  call_id=${row.call_id} | uniqueid=${row.uniqueid} | anexo=${row.anexo} | agente=${row.empleado_name || row.agente_id}`);
      }
    }

  } finally {
    await pg.end().catch(() => {});
    server.close();
    ssh.end();
    await db.destroy();
  }

  console.log('\n=== Diagnóstico completado ===\n');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
