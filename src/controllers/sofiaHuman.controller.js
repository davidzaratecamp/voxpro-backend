const { execFile } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const fs = require('fs');
const path = require('path');
const asyncHandler = require('../middleware/asyncHandler');
const SofiaHumanService = require('../services/SofiaHumanService');
const voicebotSource = require('../config/voicebotSource');
const { downloadBuffer } = require('./RealtimeScanService');
const { resolveAllowedClientCodes, CLIENT_CODES } = require('../utils/sofiaHumanAccess');

const execFileAsync = promisify(execFile);

/** Lanza 403 si el usuario no tiene acceso a esa campaña. `allowed === null` = sin restricción. */
function assertClientAccess(req, clientCode) {
  const allowed = resolveAllowedClientCodes(req.user);
  if (allowed !== null && !allowed.includes(clientCode)) {
    const err = new Error('Sin acceso a esta campaña');
    err.statusCode = 403;
    throw err;
  }
}

function clientCodeForProyecto(proyectoId) {
  const clientCode = voicebotSource.humanProyectos[proyectoId];
  if (!clientCode) {
    const err = new Error('proyecto_id inválido');
    err.statusCode = 400;
    throw err;
  }
  return clientCode;
}

async function loadSelectionWithAccess(req) {
  const selection = await SofiaHumanService.getSelectionById(Number(req.params.id));
  if (!selection) {
    const err = new Error('Selección no encontrada');
    err.statusCode = 404;
    throw err;
  }
  assertClientAccess(req, selection.client_code);
  return selection;
}

// GET /api/sofia-human/calls?date=&client_code=
exports.list = asyncHandler(async (req, res) => {
  const { date, client_code } = req.query;
  const allowed = resolveAllowedClientCodes(req.user);

  let clientCodes;
  if (client_code) {
    assertClientAccess(req, client_code);
    clientCodes = [client_code];
  } else {
    clientCodes = allowed === null ? CLIENT_CODES : allowed;
  }

  const data = await SofiaHumanService.listCallsForDay({ clientCodes, date });
  res.json({ data, count: data.length });
});

// GET /api/sofia-human/selections?status=&date_from=&date_to=&agente=&client_code=
exports.listSelections = asyncHandler(async (req, res) => {
  const { status, date_from, date_to, agente, client_code } = req.query;
  const allowed = resolveAllowedClientCodes(req.user);

  let clientCodes;
  if (client_code) {
    assertClientAccess(req, client_code);
    clientCodes = [client_code];
  } else {
    clientCodes = allowed === null ? CLIENT_CODES : allowed;
  }

  const data = await SofiaHumanService.listSelections({ clientCodes, status, dateFrom: date_from, dateTo: date_to, agente });
  res.json({ data, count: data.length });
});

// POST /api/sofia-human/select { registro_llamada_id, proyecto_id }
exports.select = asyncHandler(async (req, res) => {
  const proyectoId = Number(req.body.proyecto_id);
  const clientCode = clientCodeForProyecto(proyectoId);
  assertClientAccess(req, clientCode);

  const result = await SofiaHumanService.selectOne({
    registroLlamadaId: Number(req.body.registro_llamada_id),
    proyectoId,
    userId: req.user.id,
  });
  res.json({ data: result });
});

// GET /api/sofia-human/selections/:id
exports.getById = asyncHandler(async (req, res) => {
  const selection = await loadSelectionWithAccess(req);
  res.json({ data: selection });
});

// PATCH /api/sofia-human/selections/:id { status, notes }
exports.update = asyncHandler(async (req, res) => {
  await loadSelectionWithAccess(req);
  const { status, notes } = req.body;
  await SofiaHumanService.updateStatus(Number(req.params.id), { status, notes });
  res.json({ message: 'Actualizado' });
});

// GET /api/sofia-human/selections/:id/audio
exports.streamAudio = asyncHandler(async (req, res) => {
  const selection = await loadSelectionWithAccess(req);
  if (!selection.audiofile) return res.status(404).json({ error: true, message: 'Audio no encontrado' });

  const audioUrl = SofiaHumanService.getAudioUrl(selection.audiofile);
  const audioBuffer = await downloadBuffer(audioUrl);

  const tmpDir = os.tmpdir();
  const tmpInput = path.join(tmpDir, `sofia_human_in_${Date.now()}.wav`);
  const tmpOutput = path.join(tmpDir, `sofia_human_out_${Date.now()}.wav`);

  try {
    fs.writeFileSync(tmpInput, audioBuffer);
    await execFileAsync('ffmpeg', [
      '-y', '-i', tmpInput,
      '-acodec', 'pcm_s16le',
      '-ar', '16000',
      '-ac', '1',
      tmpOutput,
    ]);
    const converted = fs.readFileSync(tmpOutput);

    res.set({
      'Content-Type': 'audio/wav',
      'Content-Length': converted.length,
      'Content-Disposition': `inline; filename="${req.params.id}.wav"`,
      'Cache-Control': 'no-store',
    });
    res.send(converted);
  } finally {
    fs.unlink(tmpInput, () => {});
    fs.unlink(tmpOutput, () => {});
  }
});

// GET /api/sofia-human/criteria/:clientCode
exports.getCriteriaTemplate = asyncHandler(async (req, res) => {
  const clientCode = req.params.clientCode;
  assertClientAccess(req, clientCode);
  const template = SofiaHumanService.getCriteriaTemplate(clientCode);
  if (!template) return res.status(404).json({ error: true, message: 'Criterios no encontrados para esta campaña' });
  res.json({ data: template });
});

// POST /api/sofia-human/selections/:id/score { criteria, notes }
exports.saveScore = asyncHandler(async (req, res) => {
  await loadSelectionWithAccess(req);

  const { criteria, notes } = req.body;
  if (!criteria || !Array.isArray(criteria.general) || !Array.isArray(criteria.highImpact)) {
    return res.status(400).json({ error: true, message: 'Se requieren criteria.general y criteria.highImpact' });
  }

  const result = await SofiaHumanService.saveScore(Number(req.params.id), { criteria, notes });
  res.json({ message: 'Calificación guardada', data: result });
});
