const { execFile } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const fs = require('fs');
const path = require('path');
const asyncHandler = require('../middleware/asyncHandler');
const VoicebotService = require('../services/VoicebotService');
const SofiaHumanService = require('../services/SofiaHumanService');
const voicebotSource = require('../config/voicebotSource');
const { downloadBuffer } = require('./RealtimeScanService');
const { resolveAllowedProyectos } = require('../utils/voicebotAccess');

const execFileAsync = promisify(execFile);

const VALID_PROYECTOS = Object.keys(voicebotSource.proyectos).map(Number);

/**
 * Lanza 403 si el usuario no tiene acceso a esa campaña. `allowed === null`
 * significa sin restricción (gestor_usuarios).
 */
function assertProyectoAccess(req, proyectoId) {
  const allowed = resolveAllowedProyectos(req.user);
  if (allowed !== null && !allowed.includes(proyectoId)) {
    const err = new Error('Sin acceso a esta campaña');
    err.statusCode = 403;
    throw err;
  }
}

/** Lanza 403 si el usuario es de solo lectura (no puede editar prompts ni el switch). */
function assertCanManage(req) {
  if (req.user?.voicebot_read_only) {
    const err = new Error('Tu usuario es de solo lectura en Auditoría IA');
    err.statusCode = 403;
    throw err;
  }
}

// GET /api/voicebot/calls
exports.list = asyncHandler(async (req, res) => {
  const { date_from, date_to, proyecto_id, only_transfer, phone, missed_transfer } = req.query;
  const allowed = resolveAllowedProyectos(req.user);

  let effectiveProyectoId = proyecto_id;
  if (allowed !== null) {
    if (proyecto_id) {
      assertProyectoAccess(req, Number(proyecto_id));
    } else {
      effectiveProyectoId = allowed;
    }
  }

  const data = await VoicebotService.listCalls({
    date_from, date_to, proyecto_id: effectiveProyectoId, only_transfer, phone, missed_transfer,
  });
  res.json({ data, count: data.length });
});

// GET /api/voicebot/calls/:callId
exports.getById = asyncHandler(async (req, res) => {
  const call = await VoicebotService.getCallById(req.params.callId);
  if (!call) return res.status(404).json({ error: true, message: 'Llamada no encontrada' });
  assertProyectoAccess(req, call.proyecto_id);
  res.json({ data: call });
});

// GET /api/voicebot/calls/:callId/audio
exports.streamAudio = asyncHandler(async (req, res) => {
  const info = await VoicebotService.getAudioFile(req.params.callId);
  if (!info) return res.status(404).json({ error: true, message: 'Audio no encontrado' });
  assertProyectoAccess(req, info.proyecto_id);

  const audioUrl = `${voicebotSource.audioBaseUrl}/${info.audiofile}`;
  const audioBuffer = await downloadBuffer(audioUrl);

  const tmpDir = os.tmpdir();
  const tmpInput = path.join(tmpDir, `voicebot_in_${Date.now()}.wav`);
  const tmpOutput = path.join(tmpDir, `voicebot_out_${Date.now()}.wav`);

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
      'Content-Disposition': `inline; filename="${req.params.callId}.wav"`,
      'Cache-Control': 'no-store',
    });
    res.send(converted);
  } finally {
    fs.unlink(tmpInput, () => {});
    fs.unlink(tmpOutput, () => {});
  }
});

// GET /api/voicebot/calls/:callId/continuation
exports.getContinuation = asyncHandler(async (req, res) => {
  const call = await VoicebotService.getCallById(req.params.callId);
  if (!call) return res.status(404).json({ error: true, message: 'Llamada no encontrada' });
  assertProyectoAccess(req, call.proyecto_id);

  if (call.hangup_reason !== 'call_transfer') {
    return res.json({ data: null });
  }

  const data = await SofiaHumanService.findAndAnalyzeContinuation(
    call.call_id, call.proyecto_id, call.telefono, call.fecha, call.hora
  );
  res.json({ data });
});

// POST /api/voicebot/calls/:callId/continuation/deliver
// El coordinador descargó/entregó el PDF de feedback — queda en su historial ("Feedback").
exports.markContinuationDelivered = asyncHandler(async (req, res) => {
  const call = await VoicebotService.getCallById(req.params.callId);
  if (!call) return res.status(404).json({ error: true, message: 'Llamada no encontrada' });
  assertProyectoAccess(req, call.proyecto_id);

  const data = await SofiaHumanService.markDelivered(call.call_id, req.user.id);
  res.json({ data });
});

// GET /api/voicebot/calls/:callId/continuation/audio
exports.streamContinuationAudio = asyncHandler(async (req, res) => {
  const call = await VoicebotService.getCallById(req.params.callId);
  if (!call) return res.status(404).json({ error: true, message: 'Llamada no encontrada' });
  assertProyectoAccess(req, call.proyecto_id);

  const cont = await SofiaHumanService.findAndAnalyzeContinuation(
    call.call_id, call.proyecto_id, call.telefono, call.fecha, call.hora
  );
  if (!cont || !cont.audiofile) return res.status(404).json({ error: true, message: 'Audio no encontrado' });

  const audioUrl = SofiaHumanService.getAudioUrl(cont.audiofile);
  const audioBuffer = await downloadBuffer(audioUrl);

  const tmpDir = os.tmpdir();
  const tmpInput = path.join(tmpDir, `voicebot_cont_in_${Date.now()}.wav`);
  const tmpOutput = path.join(tmpDir, `voicebot_cont_out_${Date.now()}.wav`);

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
      'Content-Disposition': `inline; filename="${req.params.callId}_continuation.wav"`,
      'Cache-Control': 'no-store',
    });
    res.send(converted);
  } finally {
    fs.unlink(tmpInput, () => {});
    fs.unlink(tmpOutput, () => {});
  }
});

// GET /api/voicebot/stats
exports.getStats = asyncHandler(async (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
  const allowed = resolveAllowedProyectos(req.user);
  const stats = await VoicebotService.getStats({ days, proyectoIds: allowed || undefined });
  res.json({ data: stats });
});

// GET /api/voicebot/calls/:callId/audit
exports.getCallAudit = asyncHandler(async (req, res) => {
  const audit = await VoicebotService.getCallAudit(req.params.callId);
  if (audit) assertProyectoAccess(req, audit.proyecto_id);
  res.json({ data: audit });
});

// GET /api/voicebot/prompts
exports.getPrompts = asyncHandler(async (req, res) => {
  const allowed = resolveAllowedProyectos(req.user);
  const prompts = await VoicebotService.getPrompts();
  const data = allowed === null
    ? prompts
    : Object.fromEntries(Object.entries(prompts).filter(([id]) => allowed.includes(Number(id))));
  res.json({ data });
});

// PUT /api/voicebot/prompts/:proyectoId
exports.savePrompt = asyncHandler(async (req, res) => {
  const proyectoId = Number(req.params.proyectoId);
  if (!VALID_PROYECTOS.includes(proyectoId)) {
    return res.status(400).json({ error: true, message: 'proyecto_id inválido' });
  }
  assertProyectoAccess(req, proyectoId);
  assertCanManage(req);
  const { prompt_text } = req.body;
  if (!prompt_text || !prompt_text.trim()) {
    return res.status(400).json({ error: true, message: 'prompt_text es requerido' });
  }
  await VoicebotService.savePrompt(proyectoId, prompt_text.trim(), req.user.id);
  res.json({ message: 'Prompt guardado' });
});

// GET /api/voicebot/audit-settings
exports.getAuditSettings = asyncHandler(async (req, res) => {
  const allowed = resolveAllowedProyectos(req.user);
  const settings = await VoicebotService.getAuditSettings();
  const data = allowed === null
    ? settings
    : Object.fromEntries(Object.entries(settings).filter(([id]) => allowed.includes(Number(id))));
  res.json({ data });
});

// POST /api/voicebot/audit-settings/:proyectoId/enable
exports.enableAutoAudit = asyncHandler(async (req, res) => {
  const proyectoId = Number(req.params.proyectoId);
  if (!VALID_PROYECTOS.includes(proyectoId)) {
    return res.status(400).json({ error: true, message: 'proyecto_id inválido' });
  }
  assertProyectoAccess(req, proyectoId);
  assertCanManage(req);
  const settings = await VoicebotService.setAuditEnabled(proyectoId, true, req.user.id);
  res.json({ message: 'Auditoría automática activada', data: settings });
});

// POST /api/voicebot/audit-settings/:proyectoId/disable
exports.disableAutoAudit = asyncHandler(async (req, res) => {
  const proyectoId = Number(req.params.proyectoId);
  if (!VALID_PROYECTOS.includes(proyectoId)) {
    return res.status(400).json({ error: true, message: 'proyecto_id inválido' });
  }
  assertProyectoAccess(req, proyectoId);
  assertCanManage(req);
  const settings = await VoicebotService.setAuditEnabled(proyectoId, false, req.user.id);
  res.json({ message: 'Auditoría automática desactivada', data: settings });
});
