const cron = require('node-cron');
const config = require('../config');
const ScannerService = require('../services/ScannerService');
const ZoomScannerService = require('../services/ZoomScannerService');
const AuditService = require('../services/AuditService');
const logger = require('../utils/logger');

let scanTask = null;
let zoomTodayTask = null;

function start() {
  const schedule = config.scan.cronSchedule;

  if (!cron.validate(schedule)) {
    logger.error(`Cron schedule inválido: ${schedule}`);
    return;
  }

  // Job nocturno: escaneo catch-up Aware + Zoom de ayer
  scanTask = cron.schedule(schedule, async () => {
    logger.info('Job diario: iniciando escaneo catch-up (Aware + Zoom)');
    try {
      const scanResult = await ScannerService.runCatchUp();
      logger.info('Job diario: escaneo Aware completado', scanResult);
    } catch (err) {
      logger.error('Job diario: escaneo Aware fallido', err);
    }

    if (process.env.ZOOM_ACCOUNT_ID) {
      try {
        const zoomResult = await ZoomScannerService.run();
        logger.info('Job diario: escaneo Zoom completado', zoomResult);
      } catch (err) {
        logger.error('Job diario: escaneo Zoom fallido', err);
      }
    }
  });

  // Job intradiario: escaneo Zoom de HOY cada 2 horas (7-21h)
  // Permite ver las grabaciones del día actual sin esperar al día siguiente.
  if (process.env.ZOOM_ACCOUNT_ID) {
    zoomTodayTask = cron.schedule('*/30 10-21 * * *', async () => {
      const today = new Date().toISOString().slice(0, 10);

      // Si ya hay ≥10 grabaciones Zoom >10min para hoy, no hace falta escanear
      const { count } = await db('recordings as r')
        .join('aware_sources as s', 'r.aware_source_id', 's.id')
        .where('s.source_type', 'zoom')
        .where('r.file_date', today)
        .where('r.call_duration', '>', 600)
        .count('* as count')
        .first();

      if (Number(count) >= 10) {
        logger.info(`Job intradiario: ya hay ${count} grabaciones Zoom >10min para hoy, omitiendo scan`);
        return;
      }

      logger.info(`Job intradiario: escaneando Zoom para hoy (${today}) — grabaciones actuales: ${count}`);
      try {
        const result = await ZoomScannerService.run({ targetDate: today });
        logger.info('Job intradiario: Zoom completado', result);
      } catch (err) {
        logger.error('Job intradiario: Zoom fallido', err);
      }
    });
    logger.info('Scheduler: job intradiario Zoom activado (cada 30min, 10-21h)');
  }

  logger.info(`Scheduler iniciado - job diario programado: ${schedule}`);
}

function stop() {
  if (scanTask) {
    scanTask.stop();
    scanTask = null;
  }
  if (zoomTodayTask) {
    zoomTodayTask.stop();
    zoomTodayTask = null;
  }
  logger.info('Scheduler detenido');
}

module.exports = { start, stop };
