const cron = require('node-cron');
const config = require('../config');
const ScannerService = require('../services/ScannerService');
const ZoomScannerService = require('../services/ZoomScannerService');
const AuditService = require('../services/AuditService');
const logger = require('../utils/logger');

let scanTask = null;

function start() {
  const schedule = config.scan.cronSchedule;

  if (!cron.validate(schedule)) {
    logger.error(`Cron schedule inválido: ${schedule}`);
    return;
  }

  scanTask = cron.schedule(schedule, async () => {
    logger.info('Job diario: iniciando escaneo catch-up (Aware + Zoom)');
    try {
      const scanResult = await ScannerService.runCatchUp();
      logger.info('Job diario: escaneo Aware completado', scanResult);
    } catch (err) {
      logger.error('Job diario: escaneo Aware fallido', err);
    }

    // Escaneo Zoom (solo si las credenciales están configuradas)
    if (process.env.ZOOM_ACCOUNT_ID) {
      try {
        const zoomResult = await ZoomScannerService.run();
        logger.info('Job diario: escaneo Zoom completado', zoomResult);
      } catch (err) {
        logger.error('Job diario: escaneo Zoom fallido', err);
      }
    }
  });

  logger.info(`Scheduler iniciado - job diario programado: ${schedule}`);
}

function stop() {
  if (scanTask) {
    scanTask.stop();
    scanTask = null;
    logger.info('Scheduler detenido');
  }
}

module.exports = { start, stop };
