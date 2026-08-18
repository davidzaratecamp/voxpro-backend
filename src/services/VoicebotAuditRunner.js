const db = require('../database/connection');
const logger = require('../utils/logger');
const VoicebotService = require('./VoicebotService');
const GeminiService = require('./GeminiService');

const PROYECTO_IDS = [12, 13];
const BATCH_SIZE = 20;

class VoicebotAuditRunner {
  constructor() {
    this._running = false;
  }

  /**
   * Audita con IA las llamadas del voicebot nuevas desde que se activó el
   * switch. Se invoca desde el cron (scheduler.js) cada 10 minutos.
   * Si una llamada falla, simplemente no se guarda — se reintenta sola en
   * la próxima corrida porque sigue "faltando" en voicebot_call_audits.
   *
   * Auditar 20 llamadas contra Gemini puede tardar más de 10 minutos (cada
   * llamada individual puede tomar 30-100s), así que el tick siguiente del
   * cron puede querer arrancar antes de que termine el anterior. Sin este
   * guard, corridas solapadas terminan compitiendo por las mismas llamadas
   * (duplicate key en voicebot_call_audits) y, en la práctica, se atascan
   * por completo sin volver a avanzar. Si ya hay una corrida en curso, este
   * tick simplemente se omite — no se pierde nada, la próxima corrida real
   * retoma donde quedó.
   */
  async runPendingAudits() {
    if (this._running) {
      logger.warn('VoicebotAuditRunner: la corrida anterior sigue en curso, se omite este ciclo');
      return;
    }
    this._running = true;
    try {
      await this._run();
    } finally {
      this._running = false;
    }
  }

  async _run() {
    for (const proyectoId of PROYECTO_IDS) {
      const settings = await VoicebotService.getAuditSettingsFor(proyectoId);
      if (!settings.enabled || !settings.enabled_at) continue;

      const prompt = await VoicebotService.getPrompt(proyectoId);
      if (!prompt) continue;

      let calls;
      try {
        calls = await VoicebotService.listCallsSince(proyectoId, settings.enabled_at, BATCH_SIZE);
      } catch (err) {
        logger.error(`VoicebotAuditRunner: error listando llamadas proyecto ${proyectoId}`, err);
        continue;
      }
      if (!calls.length) continue;

      const callIds = calls.map((c) => c.call_id);
      const already = await db('voicebot_call_audits').whereIn('call_id', callIds).pluck('call_id');
      const alreadySet = new Set(already);
      const pending = calls.filter((c) => !alreadySet.has(c.call_id));

      for (const call of pending) {
        try {
          const detail = await VoicebotService.getCallById(call.call_id);
          if (!detail || !detail.transcript.length) continue;

          const result = await GeminiService.analyzeVoicebotCall(prompt, detail.transcript, detail.call_summary, detail.hangup_reason);

          // onConflict/ignore como red de seguridad adicional: si por alguna
          // razón dos corridas llegan a procesar la misma llamada, la segunda
          // no revienta con duplicate key, simplemente no hace nada.
          await db('voicebot_call_audits').insert({
            call_id: call.call_id,
            proyecto_id: proyectoId,
            score: result.score,
            summary: result.summary,
            strengths: result.strengths,
            issues: result.issues,
            summary_score: result.summaryScore,
            summary_issues: result.summaryIssues,
            missed_transfer: result.missedTransfer,
            missed_transfer_reason: result.missedTransferReason,
          }).onConflict('call_id').ignore();
          logger.info(`VoicebotAuditRunner: llamada ${call.call_id} auditada (score ${result.score}, resumen ${result.summaryScore}, transferencia_perdida ${result.missedTransfer})`);
        } catch (err) {
          if (err.isSpendingCap) {
            logger.error('VoicebotAuditRunner: cuota de Gemini agotada, deteniendo auditoría automática', err);
            await VoicebotService.autoDisableAllEnabled(
              'Se agotó la cuota de tokens de Gemini (IA). La auditoría automática se detuvo sola.'
            );
            return;
          }
          logger.error(`VoicebotAuditRunner: falló auditoría de ${call.call_id}`, err);
        }
      }
    }
  }
}

module.exports = new VoicebotAuditRunner();
