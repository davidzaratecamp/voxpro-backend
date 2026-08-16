const { execFile } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const fs = require('fs');
const path = require('path');
const asyncHandler = require('../middleware/asyncHandler');
const VoicebotService = require('../services/VoicebotService');
const voicebotSource = require('../config/voicebotSource');
const { downloadBuffer } = require('./RealtimeScanService');

const execFileAsync = promisify(execFile);

const VALID_PROYECTOS = Object.keys(voicebotSource.proyectos).map(Number);

// GET /api/voicebot/calls
exports.list = asyncHandler(async (req, res) => {
  const { date_from, date_to, proyecto_id, only_transfer, phone } = req.query;
  const data = await VoicebotService.listCalls({ date_from, date_to, proyecto_id, only_transfer, phone });
  res.json({ data, count: data.length });
});

// GET /api/voicebot/calls/:callId
exports.getById = asyncHandler(async (req, res) => {
  const call = await VoicebotService.getCallById(req.params.callId);
  if (!call) return res.status(404).json({ error: true, message: 'Llamada no encontrada' });
  res.json({ data: call });
});

// GET /api/voicebot/calls/:callId/audio
exports.streamAudio = asyncHandler(async (req, res) => {
  const audiofile = await VoicebotService.getAudioFile(req.params.callId);
  if (!audiofile) return res.status(404).json({ error: true, message: 'Audio no encontrado' });

  const audioUrl = `${voicebotSource.audioBaseUrl}/${audiofile}`;
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

// GET /api/voicebot/calls/:callId/audit
exports.getCallAudit = asyncHandler(async (req, res) => {
  const audit = await VoicebotService.getCallAudit(req.params.callId);
  res.json({ data: audit });
});

// GET /api/voicebot/prompts
exports.getPrompts = asyncHandler(async (req, res) => {
  const prompts = await VoicebotService.getPrompts();
  res.json({ data: prompts });
});

// PUT /api/voicebot/prompts/:proyectoId
exports.savePrompt = asyncHandler(async (req, res) => {
  const proyectoId = Number(req.params.proyectoId);
  if (!VALID_PROYECTOS.includes(proyectoId)) {
    return res.status(400).json({ error: true, message: 'proyecto_id inválido' });
  }
  const { prompt_text } = req.body;
  if (!prompt_text || !prompt_text.trim()) {
    return res.status(400).json({ error: true, message: 'prompt_text es requerido' });
  }
  await VoicebotService.savePrompt(proyectoId, prompt_text.trim(), req.user.id);
  res.json({ message: 'Prompt guardado' });
});

// GET /api/voicebot/audit-settings
exports.getAuditSettings = asyncHandler(async (req, res) => {
  const settings = await VoicebotService.getAuditSettings();
  res.json({ data: settings });
});

// POST /api/voicebot/audit-settings/enable
exports.enableAutoAudit = asyncHandler(async (req, res) => {
  const settings = await VoicebotService.setAuditEnabled(true, req.user.id);
  res.json({ message: 'Auditoría automática activada', data: settings });
});

// POST /api/voicebot/audit-settings/disable
exports.disableAutoAudit = asyncHandler(async (req, res) => {
  const settings = await VoicebotService.setAuditEnabled(false, req.user.id);
  res.json({ message: 'Auditoría automática desactivada', data: settings });
});
