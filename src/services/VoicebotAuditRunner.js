const db = require('../database/connection');
const logger = require('../utils/logger');
const VoicebotService = require('./VoicebotService');
const GeminiService = require('./GeminiService');

const PROYECTO_IDS = [12, 13];
const BATCH_SIZE = 20;

class VoicebotAuditRunner {
  /**
   * Audita con IA las llamadas del voicebot nuevas desde que se activó el
   * switch. Se invoca desde el cron (scheduler.js) cada 10 minutos.
   * Si una llamada falla, simplemente no se guarda — se reintenta sola en
   * la próxima corrida porque sigue "faltando" en voicebot_call_audits.
   */
  async runPendingAudits() {
    const settings = await VoicebotService.getAuditSettings();
    if (!settings.enabled || !settings.enabled_at) return;

    for (const proyectoId of PROYECTO_IDS) {
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

          const result = await GeminiService.analyzeVoicebotCall(prompt, detail.transcript);

          await db('voicebot_call_audits').insert({
            call_id: call.call_id,
            proyecto_id: proyectoId,
            score: result.score,
            summary: result.summary,
            strengths: result.strengths,
            issues: result.issues,
          });
          logger.info(`VoicebotAuditRunner: llamada ${call.call_id} auditada (score ${result.score})`);
        } catch (err) {
          logger.error(`VoicebotAuditRunner: falló auditoría de ${call.call_id}`, err);
        }
      }
    }
  }
}

module.exports = new VoicebotAuditRunner();
