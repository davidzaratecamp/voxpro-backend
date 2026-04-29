/**
 * Exploración detallada de las tablas candidatas a digitación en AWARE_30.
 * Uso: node scripts/discover-digitacion-detail.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { Client: SSHClient } = require('ssh2');
const { Client: PGClient } = require('pg');
const net = require('net');
const fs = require('fs');
const config = require('../src/config');

function openTunnel(host, port) {
  return new Promise((resolve, reject) => {
    const ssh = new SSHClient();
    const sshCfg = {
      host: config.aware.ssh.host,
      port: config.aware.ssh.port,
      username: config.aware.ssh.username,
    };
    if (config.aware.ssh.privateKey) sshCfg.privateKey = fs.readFileSync(config.aware.ssh.privateKey);
    else if (config.aware.ssh.password) sshCfg.password = config.aware.ssh.password;

    ssh.on('ready', () => {
      const server = net.createServer((sock) => {
        ssh.forwardOut('127.0.0.1', 0, host, port, (err, stream) => {
          if (err) { sock.end(); return; }
          sock.pipe(stream).pipe(sock);
        });
      });
      server.listen(0, '127.0.0.1', () => resolve({ ssh, server, port: server.address().port }));
      server.on('error', reject);
    });
    ssh.on('error', reject);
    ssh.connect(sshCfg);
  });
}

async function showColumns(pg, tableName) {
  const res = await pg.query(
    `SELECT column_name, data_type, character_maximum_length
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [tableName]
  );
  for (const c of res.rows) {
    const type = c.character_maximum_length ? `${c.data_type}(${c.character_maximum_length})` : c.data_type;
    console.log(`    ${c.column_name.padEnd(40)} ${type}`);
  }
}

async function main() {
  const user = process.env.AWARE_DB_USER_GROUP1 || 'analista';
  const pass = process.env.AWARE_DB_PASS_GROUP1 || '';

  console.log('\n=== EXPLORACIÓN DETALLADA AWARE_30 ===\n');

  const { ssh, server, port } = await openTunnel('10.255.255.30', 5432);
  const pg = new PGClient({
    host: '127.0.0.1', port,
    database: 'aware', user, password: pass,
    statement_timeout: 30000,
  });

  try {
    await pg.connect();
    console.log('Conectado a AWARE_30\n');

    // ── 1. wf_vista_reporte_gestion ──────────────────────────────────────────
    console.log('━━━ wf_vista_reporte_gestion ━━━');
    await showColumns(pg, 'wf_vista_reporte_gestion');
    const cnt1 = await pg.query('SELECT COUNT(*) FROM wf_vista_reporte_gestion');
    console.log(`  Total filas: ${cnt1.rows[0].count}`);

    // Verificar si es una vista o tabla real
    const isView = await pg.query(
      `SELECT table_type FROM information_schema.tables WHERE table_name = 'wf_vista_reporte_gestion'`
    );
    console.log(`  Tipo: ${isView.rows[0]?.table_type || 'desconocido'}`);

    // Muestra con obs no nula
    const sample1 = await pg.query(
      `SELECT * FROM wf_vista_reporte_gestion
       WHERE registro_llamada_obs IS NOT NULL AND registro_llamada_obs <> ''
       LIMIT 3`
    );
    console.log(`  Registros con obs no vacía: mostrando ${sample1.rows.length}`);
    for (const r of sample1.rows) {
      console.log('  ──');
      for (const [k, v] of Object.entries(r)) {
        const val = String(v ?? 'null');
        console.log(`    ${k.padEnd(38)} ${val.substring(0, 120)}`);
      }
    }

    // Muestra general para ver qué hay
    if (sample1.rows.length === 0) {
      const sample1b = await pg.query('SELECT * FROM wf_vista_reporte_gestion LIMIT 3');
      console.log('  (sin obs, muestra general):');
      for (const r of sample1b.rows) {
        console.log('  ──');
        for (const [k, v] of Object.entries(r)) {
          const val = String(v ?? 'null');
          console.log(`    ${k.padEnd(38)} ${val.substring(0, 120)}`);
        }
      }
    }

    // ── 2. registro_llamada: ver si tiene columna de observacion propia ──────
    console.log('\n━━━ registro_llamada (columnas completas) ━━━');
    await showColumns(pg, 'registro_llamada');

    // Muestra de una fila para ver columnas con datos reales
    const sampleRl = await pg.query(
      `SELECT * FROM registro_llamada
       WHERE call_time > 60 AND call_id > 0
       ORDER BY registro_llamada_id DESC LIMIT 1`
    );
    if (sampleRl.rows.length > 0) {
      console.log('  Muestra (1 fila reciente):');
      for (const [k, v] of Object.entries(sampleRl.rows[0])) {
        const val = String(v ?? 'null');
        console.log(`    ${k.padEnd(38)} ${val.substring(0, 120)}`);
      }
    }

    // ── 3. grabacion_llamada ─────────────────────────────────────────────────
    console.log('\n━━━ grabacion_llamada ━━━');
    await showColumns(pg, 'grabacion_llamada');
    const cnt3 = await pg.query('SELECT COUNT(*) FROM grabacion_llamada');
    console.log(`  Total filas: ${cnt3.rows[0].count}`);
    if (parseInt(cnt3.rows[0].count) > 0) {
      const sample3 = await pg.query('SELECT * FROM grabacion_llamada LIMIT 2');
      for (const r of sample3.rows) {
        console.log('  ──');
        for (const [k, v] of Object.entries(r)) {
          console.log(`    ${k.padEnd(38)} ${String(v ?? 'null').substring(0, 120)}`);
        }
      }
    }

    // ── 4. nomenclatura (tipificación codes) ─────────────────────────────────
    console.log('\n━━━ nomenclatura ━━━');
    await showColumns(pg, 'nomenclatura');
    const sample4 = await pg.query('SELECT * FROM nomenclatura LIMIT 10');
    console.log(`  Total filas: ${sample4.rows.length}+`);
    for (const r of sample4.rows) {
      console.log(`    ${JSON.stringify(r)}`);
    }

    // ── 5. Verificar si registro_llamada tiene JOIN natural con gestion ───────
    console.log('\n━━━ ¿Existe vista o tabla que combine registro_llamada + obs? ━━━');
    const views = await pg.query(
      `SELECT table_name, table_type
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'VIEW'`
    );
    console.log(`  Vistas encontradas: ${views.rows.length}`);
    for (const v of views.rows) {
      console.log(`    ${v.table_name}`);
    }

    // ── 6. Buscar en registro_llamada columnas de tipificación propias ────────
    console.log('\n━━━ Columnas de registro_llamada que parecen tipificación ━━━');
    const rlCols = await pg.query(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_name = 'registro_llamada'
         AND (column_name ILIKE '%tip%' OR column_name ILIKE '%nom%'
              OR column_name ILIKE '%obs%' OR column_name ILIKE '%nota%'
              OR column_name ILIKE '%result%' OR column_name ILIKE '%digit%'
              OR column_name ILIKE '%gestion%' OR column_name ILIKE '%motiv%'
              OR column_name ILIKE '%estado%' OR column_name ILIKE '%contacto%')
       ORDER BY column_name`
    );
    if (rlCols.rows.length === 0) {
      console.log('  Ninguna columna coincide');
    } else {
      for (const c of rlCols.rows) {
        console.log(`    ${c.column_name.padEnd(40)} ${c.data_type}`);
      }
    }

    // Muestra esas columnas en datos reales
    if (rlCols.rows.length > 0) {
      const colNames = rlCols.rows.map((c) => c.column_name).join(', ');
      const sampleTip = await pg.query(
        `SELECT registro_llamada_id, call_id, ${colNames}
         FROM registro_llamada
         WHERE call_time > 60 AND call_id > 0
         ORDER BY registro_llamada_id DESC LIMIT 3`
      );
      console.log('  Muestra con esas columnas:');
      for (const r of sampleTip.rows) {
        console.log(`    ${JSON.stringify(r)}`);
      }
    }

  } finally {
    await pg.end().catch(() => {});
    server.close();
    ssh.end();
  }

  console.log('\n=== Exploración completada ===\n');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
