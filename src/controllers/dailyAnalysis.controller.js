const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('../database/connection');
const asyncHandler = require('../middleware/asyncHandler');
const RealtimeScanService = require('../services/RealtimeScanService');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * GET /api/daily-analysis/metrics?date=YYYY-MM-DD
 * Métricas del día: contactabilidad por agente, auditorías, errores frecuentes.
 */
exports.getMetrics = asyncHandler(async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const clientCodes = req.user.client_codes || [];

  // Si es coordinador, filtrar solo sus agentes
  let coordinatorAgentIds = null;
  if (req.user.role === 'coordinator') {
    const coordUser = await db('users').where('id', req.user.id).first('agent_ids');
    const raw = coordUser?.agent_ids;
    const ids = Array.isArray(raw) ? raw : (typeof raw === 'string' ? JSON.parse(raw || '[]') : []);
    coordinatorAgentIds = ids.map(String);
  }

  // 1. Llamadas Aware desde Kraken
  const [calls, zoomRows, audits] = await Promise.all([
    RealtimeScanService.getCalls(date, clientCodes),

    // 2. Grabaciones Zoom del día desde DB
    req.user.zoom_enabled
      ? db('recordings as r')
          .join('aware_sources as s', 'r.aware_source_id', 's.id')
          .where('s.source_type', 'zoom')
          .where('r.file_date', date)
          .whereNotNull('r.agent_id')
          .where('r.agent_id', '!=', '-1')
          .modify((q) => {
            if (coordinatorAgentIds) q.whereIn('r.agent_id', coordinatorAgentIds);
          })
          .select('r.agent_id', 'r.agent_name', 'r.call_duration')
      : Promise.resolve([]),

    // 3. Auditorías completadas del día
    db('audit_selections as a')
      .join('recordings as r', 'a.recording_id', 'r.id')
      .where(db.raw('DATE(r.file_date)'), date)
      .whereIn('a.client_code', clientCodes)
      .whereNotNull('a.score')
      .modify((q) => {
        if (coordinatorAgentIds) q.whereIn('a.agent_id', coordinatorAgentIds);
      })
      .select('a.agent_id', 'a.agent_name', 'a.score', 'a.status'),
  ]);

  // 4. Errores frecuentes del día desde qa_evaluations (criteria es JSON)
  const qaRaw = await db('qa_evaluations as q')
    .join('recordings as r', 'q.recording_id', 'r.id')
    .join('audit_selections as a', 'a.recording_id', 'r.id')
    .where(db.raw('DATE(r.file_date)'), date)
    .whereIn('a.client_code', clientCodes)
    .whereNotNull('q.criteria')
    .whereNotNull('a.score')
    .where('a.status', 'completed')
    .modify((q) => {
      if (coordinatorAgentIds) q.whereIn('a.agent_id', coordinatorAgentIds);
    })
    .select('q.criteria');

  const errorMap = new Map();
  for (const row of qaRaw) {
    let criteria;
    try {
      criteria = typeof row.criteria === 'string' ? JSON.parse(row.criteria) : row.criteria;
    } catch { continue; }
    for (const item of (criteria.general || [])) {
      if (!item.cumple && !item.na) {
        errorMap.set(item.label, (errorMap.get(item.label) || 0) + 1);
      }
    }
    for (const item of (criteria.highImpact || [])) {
      if (!item.cumple) {
        errorMap.set(item.label, (errorMap.get(item.label) || 0) + 1);
      }
    }
  }
  const qaErrors = Array.from(errorMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([label, count]) => ({ criterion_name: label, cnt: count }));

  // Construir mapa de agentes
  const agentMap = new Map();

  const getAgent = (id, name) => {
    if (!id || Number(id) < 0) return null;
    if (!agentMap.has(id)) {
      agentMap.set(id, {
        agent_id:         id,
        agent_name:       name || id,
        total_calls:      0,
        effective_calls:  0,
        zoom_calls:       0,
        zoom_effective:   0,
        total_duration:   0,
        audited:          false,
        audit_score:      null,
      });
    }
    return agentMap.get(id);
  };

  for (const call of calls) {
    if (coordinatorAgentIds && !coordinatorAgentIds.includes(String(call.agent_id))) continue;
    const a = getAgent(call.agent_id, call.agent_name);
    if (!a) continue;
    a.total_calls++;
    a.total_duration += call.duration || 0;
    if ((call.duration || 0) > 120) a.effective_calls++;
  }

  for (const row of zoomRows) {
    const a = getAgent(row.agent_id, row.agent_name);
    if (!a) continue;
    a.zoom_calls++;
    a.total_duration += row.call_duration || 0;
    if ((row.call_duration || 0) > 120) a.zoom_effective++;
  }

  for (const audit of audits) {
    const a = getAgent(audit.agent_id, audit.agent_name);
    if (!a) continue;
    a.audited = true;
    a.audit_score = audit.score;
  }

  const agents = Array.from(agentMap.values()).map((a) => ({
    ...a,
    contactability_rate: a.total_calls > 0
      ? Math.round(((a.effective_calls + a.zoom_effective) / (a.total_calls + a.zoom_calls)) * 100)
      : 0,
  })).sort((a, b) => b.contactability_rate - a.contactability_rate);

  // Resumen global
  const totalCalls     = agents.reduce((s, a) => s + a.total_calls + a.zoom_calls, 0);
  const totalEffective = agents.reduce((s, a) => s + a.effective_calls + a.zoom_effective, 0);
  const auditedCount   = agents.filter((a) => a.audited).length;
  const avgScore       = audits.length
    ? Math.round(audits.reduce((s, a) => s + (a.score || 0), 0) / audits.length)
    : null;

  res.json({
    data: {
      date,
      summary: {
        total_agents:       agents.length,
        total_calls:        totalCalls,
        total_effective:    totalEffective,
        contactability_rate: totalCalls > 0 ? Math.round((totalEffective / totalCalls) * 100) : 0,
        audited_agents:     auditedCount,
        avg_score:          avgScore,
      },
      agents,
      top_errors: qaErrors.map((e) => ({ criterion: e.criterion_name, count: Number(e.cnt) })),
    },
  });
});

/**
 * POST /api/daily-analysis/ai-summary
 * Genera un resumen narrativo del día usando Gemini.
 * Body: { date, metrics } — el frontend envía los datos ya cargados.
 */
exports.getAiSummary = asyncHandler(async (req, res) => {
  const { date, metrics } = req.body;
  if (!metrics) return res.status(400).json({ error: true, message: 'Faltan métricas' });

  const { summary, agents, top_errors } = metrics;

  const agentLines = agents
    .slice(0, 20)
    .map((a) => `- ${a.agent_name}: ${a.total_calls + a.zoom_calls} llamadas, ${a.effective_calls + a.zoom_effective} efectivas (${a.contactability_rate}%)${a.audited ? `, score auditoría: ${a.audit_score}` : ''}`)
    .join('\n');

  const errorLines = top_errors.length
    ? top_errors.map((e) => `- ${e.criterion}: ${e.count} fallas`).join('\n')
    : 'No hay auditorías completadas aún.';

  const prompt = `Eres un analista de calidad en un call center. Analiza el desempeño del equipo del día ${date} y genera un resumen ejecutivo en español, conciso y accionable para el supervisor.

RESUMEN GLOBAL:
- Agentes activos: ${summary.total_agents}
- Total llamadas: ${summary.total_calls}
- Contactos efectivos (>2min): ${summary.total_effective}
- Tasa de contactabilidad: ${summary.contactability_rate}%
- Agentes auditados: ${summary.audited_agents}
${summary.avg_score !== null ? `- Score promedio de auditorías: ${summary.avg_score}/100` : ''}

AGENTES (ordenados por contactabilidad):
${agentLines}

ERRORES MÁS FRECUENTES EN AUDITORÍAS DE HOY:
${errorLines}

Genera:
1. Un párrafo de diagnóstico general del día (qué tan bien va el equipo).
2. Los 3 agentes con mejor desempeño y por qué.
3. Los 3 agentes que necesitan atención inmediata y por qué.
4. Las 2-3 acciones concretas que el supervisor debería tomar HOY.

Sé directo, usa datos específicos, no uses introducciones genéricas.`;

  try {
    const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    const model = genAI.getGenerativeModel({ model: config.gemini.model });
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    res.json({ data: { summary: text, date } });
  } catch (err) {
    logger.error('DailyAnalysis AI error', err);
    res.status(500).json({ error: true, message: 'Error al generar análisis con IA' });
  }
});
