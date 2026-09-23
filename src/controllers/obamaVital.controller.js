const asyncHandler = require('../middleware/asyncHandler');
const ObamaVitalService = require('../services/ObamaVitalService');

const VALID_STATUSES = ['selected', 'in_review', 'completed', 'skipped'];

async function loadAudit(req) {
  const audit = await ObamaVitalService.getById(Number(req.params.id));
  if (!audit) {
    const err = new Error('Auditoría no encontrada');
    err.statusCode = 404;
    throw err;
  }
  return audit;
}

// GET /api/obama-vital/calls?date=&campaign=&telefono=
exports.listCalls = asyncHandler(async (req, res) => {
  const { date, campaign, telefono } = req.query;
  const data = await ObamaVitalService.listCallsForDay({ date, campaign, telefono });
  res.json({ data, count: data.length });
});

// POST /api/obama-vital/select { registro_llamada_id }
exports.select = asyncHandler(async (req, res) => {
  const registroLlamadaId = Number(req.body.registro_llamada_id);
  if (!registroLlamadaId) return res.status(400).json({ error: true, message: 'registro_llamada_id requerido' });
  const data = await ObamaVitalService.selectOne({ registroLlamadaId, userId: req.user.id });
  res.json({ data });
});

// GET /api/obama-vital/audits?status=&campaign=&date_from=&date_to=&agente=&telefono=
exports.listAudits = asyncHandler(async (req, res) => {
  const { status, campaign, date_from, date_to, agente, telefono } = req.query;
  const data = await ObamaVitalService.listAudits({ status, campaign, dateFrom: date_from, dateTo: date_to, agente, telefono });
  res.json({ data, count: data.length });
});

// GET /api/obama-vital/summary?campaign=&date_from=&date_to=
exports.summary = asyncHandler(async (req, res) => {
  const { campaign, date_from, date_to } = req.query;
  const data = await ObamaVitalService.agentSummary({ campaign, dateFrom: date_from, dateTo: date_to });
  res.json({ data });
});

// GET /api/obama-vital/audits/:id
exports.getById = asyncHandler(async (req, res) => {
  const data = await loadAudit(req);
  res.json({ data });
});

// PATCH /api/obama-vital/audits/:id { status, notes }
exports.update = asyncHandler(async (req, res) => {
  await loadAudit(req);
  const { status, notes } = req.body;
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: true, message: 'Estado inválido' });
  }
  await ObamaVitalService.updateStatus(Number(req.params.id), { status, notes });
  res.json({ message: 'Actualizado' });
});

// GET /api/obama-vital/audits/:id/audio
exports.streamAudio = asyncHandler(async (req, res) => {
  const audit = await loadAudit(req);
  if (!audit.audiofile) return res.status(404).json({ error: true, message: 'Audio no encontrado' });

  const wav = await ObamaVitalService.getPlayableAudio(audit.audiofile);
  res.set({
    'Content-Type': 'audio/wav',
    'Content-Length': wav.length,
    'Content-Disposition': `inline; filename="${audit.id}.wav"`,
    'Cache-Control': 'no-store',
  });
  res.send(wav);
});

// GET /api/obama-vital/criteria/:campaign
exports.getCriteriaTemplate = asyncHandler(async (req, res) => {
  const data = await ObamaVitalService.getCriteriaTemplate(req.params.campaign);
  res.json({ data });
});

// POST /api/obama-vital/audits/:id/score { criteria, notes }
exports.saveScore = asyncHandler(async (req, res) => {
  await loadAudit(req);
  const { criteria, notes } = req.body;
  if (!criteria || !Array.isArray(criteria.general) || !Array.isArray(criteria.highImpact)) {
    return res.status(400).json({ error: true, message: 'Se requieren criteria.general y criteria.highImpact' });
  }
  const data = await ObamaVitalService.saveScore(Number(req.params.id), { criteria, notes });
  res.json({ message: 'Calificación guardada', data });
});

// POST /api/obama-vital/audits/:id/analyze
exports.analyze = asyncHandler(async (req, res) => {
  await loadAudit(req);
  const data = await ObamaVitalService.analyze(Number(req.params.id));
  res.json({ message: 'Análisis completado', data });
});
