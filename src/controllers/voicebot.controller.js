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
