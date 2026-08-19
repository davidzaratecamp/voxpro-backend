const db = require('../database/connection');
const logger = require('../utils/logger');
const VoicebotService = require('./VoicebotService');
const GeminiService = require('./GeminiService');

const PROYECTO_IDS = [12, 13];
const BATCH_SIZE = 40; // cuántas llamadas se traen y procesan en paralelo por corrida, por campaña

class VoicebotAuditRunner {
  constructor() {
    this._running = false;
  }

  /**
   * Audita con IA las llamadas del voicebot nuevas desde que se activó el
   * switch. Se invoca desde el cron (scheduler.js) cada 1 minuto.
   *
   * Usa un cursor real (voicebot_audit_settings.last_scanned_at) que avanza
   * en cada corrida — nunca vuelve a pedir el mismo tramo de la fuente dos
   * veces. Sin esto, pedir siempre "las N llamadas más viejas desde que se
   * activó" hace que, en cuanto ese primer bloque queda auditado, cada
   * corrida repita la misma consulta, la descarte entera (ya auditada) y se
   * quede sin nada que hacer para siempre — pasó en producción dos veces
   * (con N=20 y N=300) antes de este fix.
   *
   * Procesar un lote puede tardar más que el intervalo del cron, así que el
   * tick siguiente puede querer arrancar antes de que termine el anterior.
   * Si ya hay una corrida en curso, este tick simplemente se omite.
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

      const sinceTs = settings.last_scanned_at || settings.enabled_at;

      let calls;
      try {
        calls = await VoicebotService.listCallsSince(proyectoId, sinceTs, BATCH_SIZE);
      } catch (err) {
        logger.error(`VoicebotAuditRunner: error listando llamadas proyecto ${proyectoId}`, err);
        continue;
      }
      if (!calls.length) continue;

      const callIds = calls.map((c) => c.call_id);
      const already = await db('voicebot_call_audits').whereIn('call_id', callIds).pluck('call_id');
      const alreadySet = new Set(already);
      const pending = calls.filter((c) => !alreadySet.has(c.call_id));

      if (pending.length) {
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

      // Avanza el cursor al final de este bloque SIEMPRE que se haya podido
      // revisar completo (haya o no quedado algo pendiente en él) — así la
      // próxima corrida pide el tramo siguiente en vez de repetir este.
      const last = calls[calls.length - 1];
      await VoicebotService.advanceScanCursor(proyectoId, `${last.fecha} ${last.hora}`);
    }
  }

  /**
   * Audita una sola llamada. Los errores normales se registran y se tragan
   * (esa llamada se reintenta sola en la próxima corrida si el cursor aún
   * no ha avanzado más allá de ella); un error de cuota agotada se relanza
   * para que _run() lo detecte y detenga todo.
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
