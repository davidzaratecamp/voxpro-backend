const logger = require('../utils/logger');
const SantiService = require('./SantiService');

const BATCH_SIZE = 20;

/**
 * Corre por cron cada minuto (ver scheduler.js). A diferencia de
 * VoicebotAuditRunner no tiene switch de encendido/apagado — simplemente no
 * hace nada si no hay filas 'pending' en santi_audits (lista fija importada
 * de un Excel, no un flujo continuo).
 */
class SantiAuditRunner {
  constructor() {
    this._running = false;
  }

  async runPendingBatch() {
    if (this._running) return;
    this._running = true;
    try {
      const result = await SantiService.processPendingBatch(BATCH_SIZE);
      if (result.processed) {
        logger.info(`SantiAuditRunner: procesadas ${result.processed} filas (${result.matched} emparejadas con Aware)`);
      }
    } catch (err) {
      logger.error('SantiAuditRunner: error en corrida', err);
    } finally {
      this._running = false;
    }
  }
}

module.exports = new SantiAuditRunner();
