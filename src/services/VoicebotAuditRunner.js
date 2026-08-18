const db = require('../database/connection');
const logger = require('../utils/logger');
const VoicebotService = require('./VoicebotService');
const GeminiService = require('./GeminiService');

const PROYECTO_IDS = [12, 13];
const FETCH_WINDOW = 300; // ventana cruda traída de la fuente por proyecto, antes de filtrar ya-auditadas
const PROCESS_LIMIT = 40; // cuántas llamadas pendientes se procesan en paralelo por corrida, por campaña

class VoicebotAuditRunner {
  constructor() {
    this._running = false;
  }

  /**
   * Audita con IA las llamadas del voicebot nuevas desde que se activó el
   * switch. Se invoca desde el cron (scheduler.js) cada 1-2 minutos.
   * Si una llamada falla, simplemente no se guarda — se reintenta sola en
   * la próxima corrida porque sigue "faltando" en voicebot_call_audits.
   *
   * Procesar un lote puede tardar más que el intervalo del cron, así que el
   * tick siguiente puede querer arrancar antes de que termine el anterior.
   * Sin este guard, corridas solapadas terminan compitiendo por las mismas
   * llamadas y, en la práctica, se pueden atascar. Si ya hay una corrida en
   * curso, este tick simplemente se omite — no se pierde nada, la próxima
   * corrida real retoma donde quedó.
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
        // Ventana cruda generosa: si solo se pidieran las próximas N sin
        // filtrar, y esas N ya estuvieran auditadas, el runner nunca
        // avanzaría al siguiente bloque pendiente.
        calls = await VoicebotService.listCallsSince(proyectoId, settings.enabled_at, FETCH_WINDOW);
      } catch (err) {
        logger.error(`VoicebotAuditRunner: error listando llamadas proyecto ${proyectoId}`, err);
        continue;
      }
      if (!calls.length) continue;

      const callIds = calls.map((c) => c.call_id);
      const already = await db('voicebot_call_audits').whereIn('call_id', callIds).pluck('call_id');
      const alreadySet = new Set(already);
      const pending = calls.filter((c) => !alreadySet.has(c.call_id)).slice(0, PROCESS_LIMIT);
      if (!pending.length) continue;

      logger.info(`VoicebotAuditRunner: procesando ${pending.length} llamadas pendientes de proyecto ${proyectoId}`);

      const results = await Promise.allSettled(
        pending.map((call) => this._processCall(call, proyectoId, prompt))
      );

      const spendingCapHit = results.some((r) => r.status === 'rejected' && r.reason?.isSpendingCap);
      if (spendingCapHit) {
        logger.error('VoicebotAuditRunner: cuota de Gemini agotada, deteniendo auditoría automática');
        await VoicebotService.autoDisableAllEnabled(
          'Se agotó la cuota de tokens de Gemini (IA). La auditoría automática se detuvo sola.'
        );
        return;
      }
    }
  }

  /**
   * Audita una sola llamada. Los errores normales se registran y se tragan
   * (esa llamada se reintenta sola en la próxima corrida); un error de cuota
   * agotada se relanza para que _run() lo detecte y detenga todo.
   */
  async _processCall(call, proyectoId, prompt) {
    try {
      const detail = await VoicebotService.getCallById(call.call_id);
      if (!detail || !detail.transcript.length) return;

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
      if (err.isSpendingCap) throw err;
      logger.error(`VoicebotAuditRunner: falló auditoría de ${call.call_id}`, err);
    }
  }
}

module.exports = new VoicebotAuditRunner();
