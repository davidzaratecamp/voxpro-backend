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
    zoomTodayTask = cron.schedule('0 7,9,11,13,15,17,19,21 * * *', async () => {
      const today = new Date().toISOString().slice(0, 10);
      logger.info(`Job intradiario: escaneando Zoom para hoy (${today})`);
      try {
        const result = await ZoomScannerService.run({ targetDate: today });
        logger.info('Job intradiario: Zoom completado', result);
      } catch (err) {
        logger.error('Job intradiario: Zoom fallido', err);
      }
    });
    logger.info('Scheduler: job intradiario Zoom activado (cada 2h, 7-21h)');
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
