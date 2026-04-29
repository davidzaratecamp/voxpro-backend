require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Client: SSHClient } = require('ssh2');
const { Client: PGClient } = require('pg');
const net = require('net');
const fs = require('fs');
const config = require('../src/config');

function openTunnel() {
  return new Promise((resolve, reject) => {
    const ssh = new SSHClient();
    const c = {
      host: config.aware.ssh.host,
      port: config.aware.ssh.port,
      username: config.aware.ssh.username,
    };
    if (config.aware.ssh.privateKey) c.privateKey = fs.readFileSync(config.aware.ssh.privateKey);
    else if (config.aware.ssh.password) c.password = config.aware.ssh.password;
    ssh.on('ready', () => {
      const srv = net.createServer((s) => {
        ssh.forwardOut('127.0.0.1', 0, '10.255.255.30', 5432, (err, st) => {
          if (err) { s.end(); return; }
          s.pipe(st).pipe(s);
        });
      });
      srv.listen(0, '127.0.0.1', () => resolve({ ssh, srv, port: srv.address().port }));
      srv.on('error', reject);
    });
    ssh.on('error', reject);
    ssh.connect(c);
  });
}

async function run() {
  const { ssh, srv, port } = await openTunnel();
  const pg = new PGClient({
    host: '127.0.0.1', port,
    database: 'aware',
    user: process.env.AWARE_DB_USER_GROUP1 || 'analista',
    password: process.env.AWARE_DB_PASS_GROUP1 || '',
    statement_timeout: 30000,
  });

  try {
    await pg.connect();

    // Todos los códigos de nomenclatura
    const r1 = await pg.query(
      'SELECT nomenclatura_id, nomenclatura_nombre, proyecto_id FROM nomenclatura ORDER BY proyecto_id, nomenclatura_nombre'
    );
    console.log('=== NOMENCLATURA (tipificaciones) ===');
    for (const r of r1.rows) {
      console.log(`  proyecto=${r.proyecto_id} | ${String(r.nomenclatura_id).padEnd(8)} | ${r.nomenclatura_nombre}`);
    }

    // Tipificaciones usadas hoy
    const r2 = await pg.query(
      `SELECT nomenclatura_id, COUNT(*) cnt
       FROM registro_llamada
       WHERE registro_llamada_fecha = CURRENT_DATE AND call_id > 0
       GROUP BY nomenclatura_id ORDER BY cnt DESC LIMIT 15`
    );
    console.log('\n=== TIPIFICACIONES DE HOY (AWARE_30) ===');
    for (const r of r2.rows) {
      console.log(`  ${String(r.nomenclatura_id || 'null').padEnd(10)} ${r.cnt}`);
    }

    // Estadísticas de obs hoy
    const r3 = await pg.query(
      `SELECT COUNT(*) total,
              COUNT(CASE WHEN registro_llamada_obs IS NOT NULL AND registro_llamada_obs <> '' THEN 1 END) con_obs
       FROM registro_llamada
       WHERE registro_llamada_fecha = CURRENT_DATE AND call_id > 0`
    );
    console.log('\n=== OBSERVACIONES HOY ===');
    console.log(`  Total llamadas: ${r3.rows[0].total}`);
    console.log(`  Con obs:        ${r3.rows[0].con_obs}`);

    // Muestra de obs no vacías de hoy
    const r4 = await pg.query(
      `SELECT call_id, nomenclatura_id, registro_llamada_obs
       FROM registro_llamada
       WHERE registro_llamada_fecha = CURRENT_DATE
         AND registro_llamada_obs IS NOT NULL
         AND registro_llamada_obs <> ''
         AND call_id > 0
       LIMIT 5`
    );
    console.log('\n=== MUESTRA OBS NO VACÍAS HOY ===');
    for (const r of r4.rows) {
      console.log(`  call_id=${r.call_id} | nom=${r.nomenclatura_id} | obs=${String(r.registro_llamada_obs).substring(0, 120)}`);
    }

    // Verificar si motivo_rechazo tiene tabla de lookup
    const r5 = await pg.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND (table_name ILIKE '%motivo%' OR table_name ILIKE '%rechazo%')`
    );
    console.log('\n=== TABLAS DE MOTIVO/RECHAZO ===');
    for (const r of r5.rows) console.log(`  ${r.table_name}`);

    if (r5.rows.length > 0) {
      for (const t of r5.rows) {
        const cols = await pg.query(
          `SELECT column_name FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`,
          [t.table_name]
        );
        const sample = await pg.query(`SELECT * FROM ${t.table_name} LIMIT 5`);
        console.log(`  ${t.table_name}: ${cols.rows.map((c) => c.column_name).join(', ')}`);
        for (const r of sample.rows) console.log(`    ${JSON.stringify(r)}`);
      }
    }

  } finally {
    await pg.end().catch(() => {});
    srv.close();
    ssh.end();
  }
}

run().catch((e) => { console.error(e.message); process.exit(1); });
