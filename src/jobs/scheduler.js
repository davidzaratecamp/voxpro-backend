const cron = require('node-cron');
const config = require('../config');
const ScannerService = require('../services/ScannerService');
const ZoomScannerService = require('../services/ZoomScannerService');
const AuditService = require('../services/AuditService');
const VoicebotAuditRunner = require('../services/VoicebotAuditRunner');
const db = require('../database/connection');
const logger = require('../utils/logger');

let scanTask = null;
let zoomTodayTask = null;
let cleanupTask = null;
let voicebotAuditTask = null;

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
      const today = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);

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

  // Job de limpieza: borra grabaciones Aware sin auditar de más de 30 días
  // Las auditadas (en audit_selections) nunca se tocan.
  cleanupTask = cron.schedule('30 3 * * *', async () => {
    logger.info('Job limpieza: eliminando grabaciones Aware sin auditar >30 días');
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      const deleted = await db('recordings')
        .whereNotIn('id', db('audit_selections').select('recording_id').whereNotNull('recording_id'))
        .whereRaw('aware_source_id IN (SELECT id FROM aware_sources WHERE source_type != ?)', ['zoom'])
        .where('file_date', '<', cutoffStr)
        .delete();

      logger.info(`Job limpieza: ${deleted} grabaciones Aware eliminadas (anteriores a ${cutoffStr})`);
    } catch (err) {
      logger.error('Job limpieza: error', err);
    }
  });

  // Job de auditoría IA del voicebot: audita llamadas nuevas de Claro cada 10min
  voicebotAuditTask = cron.schedule('*/10 * * * *', async () => {
    try {
      await VoicebotAuditRunner.runPendingAudits();
    } catch (err) {
      logger.error('Job voicebot-audit: error', err);
    }
  });

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
  if (cleanupTask) {
    cleanupTask.stop();
    cleanupTask = null;
  }
  if (voicebotAuditTask) {
    voicebotAuditTask.stop();
    voicebotAuditTask = null;
  }
  logger.info('Scheduler detenido');
}

module.exports = { start, stop };
