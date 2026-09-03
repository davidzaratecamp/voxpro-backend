const VoicebotService = require('./VoicebotService');
const db = require('../database/connection');

/**
 * Compila los resultados de auditoría IA de SOFIA (score del bot, oportunidad
 * perdida, score del asesor humano en la continuación + nombres). Lo consume el
 * endpoint /api/prisma-analytics/sofia-quality y el job que empuja el snapshot
 * a Prisma.
 */
async function getQuality({ days = 30, proyectos } = {}) {
  const d = Math.min(180, Math.max(1, Number(days) || 30));
  const requested = Array.isArray(proyectos)
    ? proyectos
    : String(proyectos || '12,13').split(',').map(Number);
  const proyectoIds = requested.filter((n) => n === 12 || n === 13);
  const ids = proyectoIds.length ? proyectoIds : [12, 13];
  const since = new Date();
  since.setDate(since.getDate() - d);

  const bot = await VoicebotService.getStats({ days: d, proyectoIds: ids });

  const missedReasons = await db('voicebot_call_audits')
    .whereIn('proyecto_id', ids)
    .where('created_at', '>=', since)
    .where('missed_transfer', true)
    .whereNotNull('missed_transfer_reason')
    .select('missed_transfer_reason')
    .orderBy('created_at', 'desc')
    .limit(20);

  // sofia_continuation_audits.proyecto_id es la cola HUMANA (7/9/10/11) o NULL;
  // el campo estable es client_code.
  const clientCodes = ids
    .map((id) => (id === 12 ? 'claro_hogar' : id === 13 ? 'claro_tyt' : null))
    .filter(Boolean);
  const cont = await db('sofia_continuation_audits')
    .whereIn('client_code', clientCodes)
    .where('created_at', '>=', since)
    .select('status', 'score', 'high_impact_failed', 'agente_id', 'agente_nombre');

  const h = { total: cont.length, scored: 0, not_found: 0, error: 0, hi_failed: 0, sum: 0, low: 0, mid: 0, high: 0 };
  const byAgent = new Map();
  for (const c of cont) {
    if (c.status === 'not_found') h.not_found += 1;
    else if (c.status === 'error') h.error += 1;
    else if (c.status === 'scored') {
      h.scored += 1;
      const s = Number(c.score) || 0;
      h.sum += s;
      if (c.high_impact_failed) h.hi_failed += 1;
      if (s < 60) h.low += 1;
      else if (s < 80) h.mid += 1;
      else h.high += 1;
      const key = c.agente_id || 'sin_id';
      const a = byAgent.get(key) || { agente_id: c.agente_id, agente_nombre: null, audited: 0, sum: 0, hi_failed: 0 };
      a.audited += 1;
      a.sum += s;
      if (c.high_impact_failed) a.hi_failed += 1;
      if (c.agente_nombre) a.agente_nombre = c.agente_nombre;
      byAgent.set(key, a);
    }
  }

  return {
    generated_at: new Date().toISOString(),
    range_days: d,
    proyectos: ids,
    bot, // { by_proyecto: [...], trend: [...] }
    human: {
      total: h.total,
      scored: h.scored,
      not_found: h.not_found,
      not_found_rate: h.total ? Math.round((h.not_found / h.total) * 10000) / 10000 : null,
      error: h.error,
      avg_score: h.scored ? Math.round(h.sum / h.scored) : null,
      distribution: { low: h.low, mid: h.mid, high: h.high },
      high_impact_failed: h.hi_failed,
      high_impact_failed_rate: h.scored ? Math.round((h.hi_failed / h.scored) * 10000) / 10000 : null,
    },
    missed_transfer_reasons: missedReasons.map((r) => r.missed_transfer_reason),
    agents: [...byAgent.values()]
      .map((a) => ({
        agente_id: a.agente_id,
        agente_nombre: a.agente_nombre,
        audited: a.audited,
        avg_score: a.audited ? Math.round(a.sum / a.audited) : null,
        high_impact_failed: a.hi_failed,
      }))
      .sort((x, y) => y.audited - x.audited),
  };
}

module.exports = { getQuality };
