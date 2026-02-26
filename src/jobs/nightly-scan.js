#!/usr/bin/env node

/**
 * Script standalone para ejecutar el escaneo nocturno.
 * Diseñado para ser invocado por cron del sistema operativo:
 *
 *   0 2 * * * cd /ruta/al/backend && /usr/bin/node src/jobs/nightly-scan.js >> logs/cron.log 2>&1
 *
 * Acepta argumentos:
 *   --date YYYY-MM-DD   Escanear una fecha específica (default: ayer)
 *   --full              Escaneo completo de todas las fechas
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const ScannerService = require('../services/ScannerService');
const logger = require('../utils/logger');
const db = require('../database/connection');

async function main() {
  const args = process.argv.slice(2);
  const fullScan = args.includes('--full');
  const dateIdx = args.indexOf('--date');
  const targetDate = dateIdx !== -1 ? args[dateIdx + 1] : undefined;

  logger.info('=== NIGHTLY SCAN START ===', { targetDate, fullScan });
  const startTime = Date.now();

  try {
    const result = await ScannerService.run({ targetDate, fullScan });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    logger.info('=== NIGHTLY SCAN COMPLETE ===', {
      ...result,
      elapsed_seconds: elapsed,
    });

    console.log(`Escaneo completado en ${elapsed}s:`, JSON.stringify(result));
  } catch (err) {
    logger.error('=== NIGHTLY SCAN FAILED ===', err);
    console.error('Escaneo fallido:', err.message);
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}

main();
