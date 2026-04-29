/**
 * Verifica la digitación en todos los servidores Aware de Obama:
 * AWARE_30 (10.255.255.30), AWARE_31 (10.255.255.31),
 * AWARE_5  (10.255.255.5),  AWARE_32 (10.255.255.32)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { Client: SSHClient } = require('ssh2');
const { Client: PGClient } = require('pg');
const net = require('net');
const fs = require('fs');
const config = require('../src/config');

const OBAMA_SERVERS = [
  { folder: 'AWARE_30', host: '10.255.255.30' },
  { folder: 'AWARE_31', host: '10.255.255.31' },
  { folder: 'AWARE_5',  host: '10.255.255.5'  },
  { folder: 'AWARE_32', host: '10.255.255.32' },
];

function openTunnel(host) {
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
        ssh.forwardOut('127.0.0.1', 0, host, 5432, (err, st) => {
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

async function checkServer(server) {
  const user = process.env.AWARE_DB_USER_GROUP1 || 'analista';
  const pass = process.env.AWARE_DB_PASS_GROUP1 || '';

  console.log(`\n${'━'.repeat(60)}`);
  console.log(`${server.folder}  (${server.host})`);
  console.log('━'.repeat(60));

  let ssh, srv, pg;
  try {
    const tunnel = await openTunnel(server.host);
    ssh = tunnel.ssh; srv = tunnel.srv;

    pg = new PGClient({
      host: '127.0.0.1', port: tunnel.port,
      database: 'aware', user, password: pass,
      statement_timeout: 20000,
    });
    await pg.connect();

    // 1. Verificar que registro_llamada tiene nomenclatura_id y obs
    const colCheck = await pg.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'registro_llamada'
         AND column_name IN ('nomenclatura_id','registro_llamada_obs','motivo_rechazo_id')
       ORDER BY column_name`
    );
    const cols = colCheck.rows.map((r) => r.column_name);
    console.log(`  Columnas digitación presentes: ${cols.join(', ') || 'NINGUNA'}`);

    // 2. Nomenclaturas disponibles
    const nomRes = await pg.query(
      `SELECT nomenclatura_id, nomenclatura_nombre, proyecto_id
       FROM nomenclatura ORDER BY proyecto_id, nomenclatura_nombre`
    );
    console.log(`  Nomenclaturas (${nomRes.rows.length}):`);
    for (const r of nomRes.rows) {
      console.log(`    proy=${r.proyecto_id} | ${String(r.nomenclatura_id).padEnd(8)} | ${r.nomenclatura_nombre}`);
    }

    // 3. Estadísticas de hoy
    const stats = await pg.query(
      `SELECT COUNT(*) total,
              COUNT(CASE WHEN nomenclatura_id IS NOT NULL THEN 1 END) con_tipif,
              COUNT(CASE WHEN registro_llamada_obs IS NOT NULL AND registro_llamada_obs <> '' THEN 1 END) con_obs
       FROM registro_llamada
       WHERE registro_llamada_fecha = CURRENT_DATE AND call_id > 0`
    );
    const s = stats.rows[0];
    console.log(`  Hoy: ${s.total} llamadas | ${s.con_tipif} con tipificación | ${s.con_obs} con obs`);

    // 4. Distribución de tipificaciones hoy
    const tipHoy = await pg.query(
      `SELECT nomenclatura_id, COUNT(*) cnt
       FROM registro_llamada
       WHERE registro_llamada_fecha = CURRENT_DATE AND call_id > 0
       GROUP BY nomenclatura_id ORDER BY cnt DESC LIMIT 10`
    );
    if (tipHoy.rows.length > 0) {
      console.log('  Tipificaciones hoy:');
      for (const r of tipHoy.rows) {
        console.log(`    ${String(r.nomenclatura_id || 'null').padEnd(8)} ${r.cnt}`);
      }
    }

    // 5. Muestra de obs con texto real del agente (no código técnico)
    const obsSample = await pg.query(
      `SELECT call_id, nomenclatura_id, registro_llamada_obs
       FROM registro_llamada
       WHERE registro_llamada_fecha = CURRENT_DATE
         AND registro_llamada_obs IS NOT NULL
         AND registro_llamada_obs <> ''
         AND registro_llamada_obs NOT LIKE '%,%'
         AND call_id > 0
       LIMIT 5`
    );
    if (obsSample.rows.length > 0) {
      console.log('  Obs con texto manual (sin coma = no código técnico):');
      for (const r of obsSample.rows) {
        console.log(`    call_id=${r.call_id} | ${r.nomenclatura_id} | ${String(r.registro_llamada_obs).substring(0, 100)}`);
      }
    } else {
      console.log('  (sin obs manuales hoy sin formato código técnico)');
    }

  } catch (err) {
    console.log(`  ERROR: ${err.message}`);
  } finally {
    if (pg) await pg.end().catch(() => {});
    if (srv) srv.close();
    if (ssh) ssh.end();
  }
}

async function main() {
  console.log('=== VERIFICACIÓN DE DIGITACIÓN EN TODOS LOS AWARE DE OBAMA ===');
  for (const server of OBAMA_SERVERS) {
    await checkServer(server);
  }
  console.log('\n=== Verificación completada ===\n');
}

main().catch((err) => { console.error(err.message); process.exit(1); });
