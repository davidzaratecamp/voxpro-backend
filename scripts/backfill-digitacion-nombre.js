/**
 * Rellena digitacion_nombre para grabaciones donde el código existe pero el nombre quedó null.
 * Ocurre cuando el scanner corrió antes del fix del LATERAL JOIN (proyecto_id mismatch en nomenclatura).
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { Client: SSHClient } = require('ssh2');
const { Client: PGClient } = require('pg');
const net = require('net');
const fs = require('fs');
const config = require('../src/config');
const db = require('../src/database/connection');
const AWARE_SOURCES = require('../src/config/sources');

function openTunnel(host, port = 5432) {
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
        ssh.forwardOut('127.0.0.1', 0, host, port, (err, st) => {
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

async function getNomenclaturaMap(dbCfg) {
  const tunnel = await openTunnel(dbCfg.host, dbCfg.port || 5432);
  const pg = new PGClient({
    host: '127.0.0.1',
    port: tunnel.port,
    database: dbCfg.database,
    user: dbCfg.user,
    password: dbCfg.password,
    statement_timeout: 15000,
  });
  try {
    await pg.connect();
    const result = await pg.query(
      `SELECT TRIM(nomenclatura_id::text) AS code, TRIM(nomenclatura_nombre::text) AS name
       FROM nomenclatura
       WHERE nomenclatura_id IS NOT NULL AND nomenclatura_nombre IS NOT NULL`
    );
    const map = new Map();
    for (const row of result.rows) {
      const code = row.code?.trim();
      const name = row.name?.trim();
      if (code && name && !map.has(code)) {
        map.set(code, name);
      }
    }
    return map;
  } finally {
    await pg.end().catch(() => {});
    tunnel.srv.close();
    tunnel.ssh.end();
  }
}

async function main() {
  console.log('=== BACKFILL digitacion_nombre ===\n');

  // Grabaciones con código pero sin nombre, agrupadas por folder_name del source
  const pending = await db('recordings as r')
    .join('aware_sources as s', 'r.aware_source_id', 's.id')
    .whereNotNull('r.digitacion_nomenclatura')
    .whereNull('r.digitacion_nombre')
    .select('s.id as source_id', 's.folder_name', db.raw('COUNT(*) as cnt'))
    .groupBy('s.id', 's.folder_name');

  if (!pending.length) {
    console.log('No hay grabaciones con digitacion_nombre null. Nada que hacer.');
    await db.destroy();
    return;
  }

  console.log(`Fuentes pendientes: ${pending.length}`);
  for (const row of pending) console.log(`  ${row.folder_name}: ${row.cnt} grabaciones`);
  console.log('');

  // Índice de sources por folder_name (puede haber varios clientes en el mismo folder/host)
  // Tomamos solo una instancia por host+database para evitar túneles duplicados
  const sourceByFolder = new Map();
  for (const src of AWARE_SOURCES) {
    if (!sourceByFolder.has(src.folder)) {
      sourceByFolder.set(src.folder, src);
    }
  }

  let totalUpdated = 0;

  for (const { source_id, folder_name, cnt } of pending) {
    const srcCfg = sourceByFolder.get(folder_name);
    if (!srcCfg) {
      console.log(`  ${folder_name}: sin config en sources.js, omitido`);
      continue;
    }

    console.log(`Procesando ${folder_name} (${srcCfg.db.host}) — ${cnt} grabaciones...`);
    try {
      const nomenclaturaMap = await getNomenclaturaMap(srcCfg.db);
      console.log(`  ${nomenclaturaMap.size} códigos en nomenclatura`);

      for (const [code, name] of nomenclaturaMap) {
        const updated = await db('recordings')
          .where('aware_source_id', source_id)
          .where('digitacion_nomenclatura', code)
          .whereNull('digitacion_nombre')
          .update({ digitacion_nombre: name });

        if (updated > 0) {
          console.log(`    ${code} → "${name}": ${updated}`);
          totalUpdated += updated;
        }
      }
    } catch (err) {
      console.error(`  ERROR en ${folder_name}: ${err.message}`);
    }
  }

  console.log(`\nTotal actualizado: ${totalUpdated} grabaciones`);
  await db.destroy();
}

main().catch((err) => { console.error(err.message); process.exit(1); });
