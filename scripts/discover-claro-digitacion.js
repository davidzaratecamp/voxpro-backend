/**
 * Verifica la digitación en todos los servidores Aware de Claro:
 * AWARE_8  (10.255.255.8)  → claro_tyt  (schema standard)
 * AWARE_4  (10.255.255.4)  → claro_hogar (schema standard)
 * AWARE_34 (10.255.255.34) → claro_wcb  (schema awareccm)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { Client: SSHClient } = require('ssh2');
const { Client: PGClient } = require('pg');
const net = require('net');
const fs = require('fs');
const config = require('../src/config');

const CLARO_SERVERS = [
  { folder: 'AWARE_8',   host: '10.255.255.8',  database: 'aware',    schema: 'standard', client: 'claro_tyt',   group: 1 },
  { folder: 'AWARE_4',   host: '10.255.255.4',  database: 'aware',    schema: 'standard', client: 'claro_hogar', group: 2 },
  { folder: 'AWARE_34',  host: '10.255.255.34', database: 'awareccm', schema: 'awareccm', client: 'claro_wcb',   group: 2 },
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

async function checkServer(srv) {
  const user = srv.group === 1
    ? (process.env.AWARE_DB_USER_GROUP1 || 'analista')
    : (process.env.AWARE_DB_USER_GROUP2 || 'analista');
  const pass = srv.group === 1
    ? (process.env.AWARE_DB_PASS_GROUP1 || '')
    : (process.env.AWARE_DB_PASS_GROUP2 || '');

  console.log(`\n${'━'.repeat(60)}`);
  console.log(`${srv.folder}  (${srv.host})  cliente: ${srv.client}  schema: ${srv.schema}`);
  console.log('━'.repeat(60));

  let ssh, tunnel, pg;
  try {
    tunnel = await openTunnel(srv.host);
    ssh = tunnel.ssh;

    pg = new PGClient({
      host: '127.0.0.1', port: tunnel.port,
      database: srv.database, user, password: pass,
      statement_timeout: 20000,
    });
    await pg.connect();
    console.log('  Conectado a PostgreSQL');

    // 1. Columnas de digitación en registro_llamada
    const colCheck = await pg.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'registro_llamada'
         AND column_name IN ('nomenclatura_id','registro_llamada_obs','motivo_rechazo_id')
       ORDER BY column_name`
    );
    const cols = colCheck.rows.map((r) => r.column_name);
    console.log(`  Columnas digitación presentes: ${cols.length > 0 ? cols.join(', ') : 'NINGUNA ✗'}`);

    // 2. ¿Existe tabla nomenclatura?
    const nomTable = await pg.query(
      `SELECT COUNT(*) cnt FROM information_schema.tables
       WHERE table_name = 'nomenclatura' AND table_schema = 'public'`
    );
    const hasNomTable = parseInt(nomTable.rows[0].cnt) > 0;
    console.log(`  Tabla nomenclatura: ${hasNomTable ? 'SÍ' : 'NO ✗'}`);

    if (hasNomTable) {
      const nomCols = await pg.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'nomenclatura' ORDER BY ordinal_position`
      );
      console.log(`  Columnas nomenclatura: ${nomCols.rows.map((r) => r.column_name).join(', ')}`);

      const nomRows = await pg.query(
        `SELECT nomenclatura_id, nomenclatura_nombre, proyecto_id FROM nomenclatura ORDER BY proyecto_id, nomenclatura_nombre`
      );
      console.log(`  Códigos (${nomRows.rows.length}):`);
      for (const r of nomRows.rows) {
        console.log(`    proy=${r.proyecto_id} | ${String(r.nomenclatura_id).padEnd(8)} | ${r.nomenclatura_nombre}`);
      }
    }

    // 3. ¿Existe tabla nomenclatura_rechazo?
    const rejTable = await pg.query(
      `SELECT COUNT(*) cnt FROM information_schema.tables
       WHERE table_name = 'nomenclatura_rechazo' AND table_schema = 'public'`
    );
    const hasRejTable = parseInt(rejTable.rows[0].cnt) > 0;
    console.log(`  Tabla nomenclatura_rechazo: ${hasRejTable ? 'SÍ' : 'NO'}`);

    if (hasRejTable) {
      const rejRows = await pg.query(`SELECT * FROM nomenclatura_rechazo LIMIT 5`);
      for (const r of rejRows.rows) console.log(`    ${JSON.stringify(r)}`);
    }

    // 4. Estadísticas de ayer
    const stats = await pg.query(
      `SELECT COUNT(*) total,
              COUNT(CASE WHEN nomenclatura_id IS NOT NULL THEN 1 END) con_tipif,
              COUNT(CASE WHEN registro_llamada_obs IS NOT NULL AND registro_llamada_obs <> '' THEN 1 END) con_obs
       FROM registro_llamada
       WHERE registro_llamada_fecha = CURRENT_DATE - INTERVAL '1 day'
         AND call_id > 0`
    );
    const s = stats.rows[0];
    console.log(`  Ayer: ${s.total} llamadas | ${s.con_tipif} con tipif | ${s.con_obs} con obs`);

    // 5. Muestra de obs con texto manual (ayer)
    const obsSample = await pg.query(
      `SELECT call_id, nomenclatura_id, registro_llamada_obs
       FROM registro_llamada
       WHERE registro_llamada_fecha = CURRENT_DATE - INTERVAL '1 day'
         AND registro_llamada_obs IS NOT NULL
         AND registro_llamada_obs <> ''
         AND registro_llamada_obs NOT LIKE '%,%'
         AND call_id > 0
       LIMIT 5`
    );
    if (obsSample.rows.length > 0) {
      console.log('  Obs manuales de ayer:');
      for (const r of obsSample.rows) {
        console.log(`    call_id=${r.call_id} | ${r.nomenclatura_id} | ${String(r.registro_llamada_obs).substring(0, 100)}`);
      }
    } else {
      console.log('  Sin obs manuales ayer');
    }

  } catch (err) {
    console.log(`  ERROR: ${err.message}`);
  } finally {
    if (pg) await pg.end().catch(() => {});
    if (tunnel?.srv) tunnel.srv.close();
    if (ssh) ssh.end();
  }
}

async function main() {
  console.log('=== VERIFICACIÓN DE DIGITACIÓN EN SERVIDORES AWARE DE CLARO ===');
  for (const srv of CLARO_SERVERS) {
    await checkServer(srv);
  }
  console.log('\n=== Verificación completada ===\n');
}

main().catch((err) => { console.error(err.message); process.exit(1); });
