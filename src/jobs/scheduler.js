const cron = require('node-cron');
const config = require('../config');
const ScannerService = require('../services/ScannerService');
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
    logger.info('Job diario: iniciando escaneo catch-up + selección de auditorías');
    try {
      // 1. Escanear grabaciones (catch-up: cubre días faltantes + ayer)
      const scanResult = await ScannerService.runCatchUp();
      logger.info('Job diario: escaneo completado', scanResult);

      // 2. Seleccionar auditorías del día anterior
      const auditResult = await AuditService.selectForDay();
      logger.info('Job diario: selección de auditorías completada', auditResult);
    } catch (err) {
      logger.error('Job diario: fallido', err);
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
