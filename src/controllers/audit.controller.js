const { execFile } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const fs = require('fs');
const path = require('path');
const AuditService = require('../services/AuditService');
const AnalysisService = require('../services/AnalysisService');
const SFTPService = require('../services/SFTPService');
const { downloadBuffer } = require('../services/RealtimeScanService');
const ZoomAuth = require('../services/ZoomAuthService');
const db = require('../database/connection');
const asyncHandler = require('../middleware/asyncHandler');

const execFileAsync = promisify(execFile);

/**
 * Verifica que la selección pertenece al auditor que hace la petición
 * y que su client_code está dentro de sus client_codes autorizados.
 * Retorna un objeto de error listo para responder, o null si el acceso es válido.
 *
 * Para usuarios zoom_enabled: también permite acceso a grabaciones de otros clientes
 * si el agente tiene extensión Zoom bajo un cliente autorizado del usuario.
 */
const ZOOM_SHARED = new Set(['obama', 'lv']);

async function checkAccess(selection, req) {
  if (!selection) {
    return { status: 404, body: { error: true, message: 'Selección no encontrada' } };
  }

  // Acceso directo por client_codes, O bien zoom_enabled con cliente compartido Obama/LV
  const authorized = req.user.client_codes.includes(selection.client_code) ||
    (req.user.zoom_enabled && ZOOM_SHARED.has(selection.client_code));

  if (!authorized) {
    return { status: 403, body: { error: true, message: 'Acceso no autorizado' } };
  }
  if (req.user.role !== 'supervisor_calidad' && selection.auditor_id !== null && selection.auditor_id !== req.user.id) {
    return { status: 403, body: { error: true, message: 'Acceso no autorizado' } };
  }
  return null;
}

exports.select = asyncHandler(async (req, res) => {
  const { date } = req.body;
  const result = await AuditService.selectForDay(date || null, req.user.id);
  res.json({ message: 'Selección completada', data: result });
});

exports.selectOne = asyncHandler(async (req, res) => {
  const { recording_id } = req.body;
  const userId = req.user.id;

  const recording = await db('recordings as r')
    .join('aware_sources as s', 'r.aware_source_id', 's.id')
    .join('clients as c', 's.client_id', 'c.id')
    .where('r.id', recording_id)
    .select('r.id', 'r.agent_id', 'r.agent_name', 'r.file_date', 'c.code as client_code')
    .first();

  if (!recording) return res.status(404).json({ error: true, message: 'Grabación no encontrada' });

  // Verificar acceso: el usuario tiene el cliente directamente, O bien tiene zoom_enabled
  // y la grabación es de un cliente Zoom compartido (obama/lv comparten fuentes Zoom).
  const hasDirectAccess = req.user.client_codes.includes(recording.client_code) ||
    (req.user.zoom_enabled && ZOOM_SHARED.has(recording.client_code));
  if (!hasDirectAccess) {
    return res.status(403).json({ error: true, message: 'Acceso no autorizado' });
  }

  // Calcular semana (file_date puede llegar como Date object o string)
  const dateStr = recording.file_date instanceof Date
    ? recording.file_date.toISOString().slice(0, 10)
    : String(recording.file_date).slice(0, 10);
  const [y, m, d] = dateStr.split('-').map(Number);
  const ref = new Date(Date.UTC(y, m - 1, d));
  const diff = ref.getUTCDay() === 0 ? 6 : ref.getUTCDay() - 1;
  const monday = new Date(ref);
  monday.setUTCDate(ref.getUTCDate() - diff);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (dt) => dt.toISOString().slice(0, 10);

  try {
    const [id] = await db('audit_selections').insert({
      recording_id,
      agent_id: recording.agent_id,
      agent_name: recording.agent_name,
      client_code: recording.client_code,
      auditor_id: userId,
      week_start: fmt(monday),
      week_end: fmt(sunday),
      status: 'selected',
    });
    res.json({ data: { id } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
      const existing = await db('audit_selections').where({ recording_id, auditor_id: userId }).first();
      return res.json({ data: { id: existing.id } });
    }
    throw err;
  }
});

exports.list = asyncHandler(async (req, res) => {
  const { week_start, client, status, date, campaign } = req.query;
  const { client_codes: clientCodes, id: userId, role } = req.user;
  const filterUserId = role === 'supervisor_calidad' ? null : userId;

  let selections = await AuditService.getWeekSelections(
    week_start || null,
    { client, status, clientCodes, date, userId: filterUserId }
  );

  if (campaign) {
    selections = selections.filter((s) => s.campaign_type === campaign);
  }

  res.json({ data: selections, count: selections.length });
});

exports.getById = asyncHandler(async (req, res) => {
  const selection = await AuditService.getById(req.params.id);
  const err = await checkAccess(selection, req);
  if (err) return res.status(err.status).json(err.body);
  res.json({ data: selection });
});

exports.update = asyncHandler(async (req, res) => {
  const { status, score, notes } = req.body;

  if (status) {
    const valid = ['selected', 'in_review', 'completed', 'skipped'];
    if (!valid.includes(status)) {
      return res.status(400).json({
        error: true,
        message: `Estado inválido. Valores permitidos: ${valid.join(', ')}`,
      });
    }
  }

  if (score !== undefined && (score < 0 || score > 100)) {
    return res.status(400).json({
      error: true,
      message: 'Score debe estar entre 0 y 100',
    });
  }

  const selection = await AuditService.getById(req.params.id);
  const err = await checkAccess(selection, req);
  if (err) return res.status(err.status).json(err.body);

  const updated = await AuditService.updateSelection(req.params.id, { status, score, notes });
  if (!updated) {
    return res.status(404).json({ error: true, message: 'Selección no encontrada' });
  }

  res.json({ message: 'Selección actualizada', data: { id: req.params.id, status, score, notes } });
});

exports.agentAudits = asyncHandler(async (req, res) => {
  const { agentId } = req.params;
  const { client } = req.query;
  const { client_codes: clientCodes, id: userId, role } = req.user;

  if (!client) {
    return res.status(400).json({ error: true, message: 'Parámetro client requerido' });
  }

  const filterUserId = role === 'supervisor_calidad' ? null : userId;
  const audits = await AuditService.getAgentAudits(agentId, client, { clientCodes, userId: filterUserId });
  res.json({ data: audits, count: audits.length });
});

exports.agentsPerformance = asyncHandler(async (req, res) => {
  const { client } = req.query;
  const { client_codes: clientCodes, id: userId, role } = req.user;
  // El supervisor ve todos los agentes de todos los auditores; el coordinador solo los suyos
  const filterUserId = role === 'supervisor_calidad' ? null : userId;
  const agents = await AuditService.agentsPerformance({ client, clientCodes, userId: filterUserId });
  res.json({ data: agents, count: agents.length });
});

exports.analyze = asyncHandler(async (req, res) => {
  const selection = await AuditService.getById(req.params.id);
  const err = await checkAccess(selection, req);
  if (err) return res.status(err.status).json(err.body);

  const result = await AnalysisService.analyzeSelection(req.params.id);
  res.json({ message: 'Análisis completado', data: result });
});

exports.reanalyze = asyncHandler(async (req, res) => {
  const selection = await AuditService.getById(req.params.id);
  const err = await checkAccess(selection, req);
  if (err) return res.status(err.status).json(err.body);

  // Borrar análisis previo para forzar re-análisis limpio
  await db('qa_evaluations').where('recording_id', selection.recording_id).delete();
  await db('transcriptions').where('recording_id', selection.recording_id).delete();
  await db('recordings').where('id', selection.recording_id).update({ status: 'transcribed' });

  const result = await AnalysisService.analyzeSelection(req.params.id);
  res.json({ message: 'Re-análisis completado', data: result });
});

exports.updateAnalysis = asyncHandler(async (req, res) => {
  const selection = await AuditService.getById(req.params.id);
  const err = await checkAccess(selection, req);
  if (err) return res.status(err.status).json(err.body);

  const { criteria, score } = req.body;
  const user = { id: req.user.id, name: req.user.name };
  const result = await AnalysisService.updateEvaluation(req.params.id, { criteria, score, user });
  if (!result) {
    return res.status(404).json({ error: true, message: 'Selección no encontrada' });
  }
  res.json({ message: 'Evaluación actualizada', data: result });
});

exports.getAnalysis = asyncHandler(async (req, res) => {
  const selection = await AuditService.getById(req.params.id);
  const err = await checkAccess(selection, req);
  if (err) return res.status(err.status).json(err.body);

  const results = await AnalysisService.getResults(req.params.id);
  if (!results) {
    return res.status(404).json({ error: true, message: 'No hay análisis para esta selección' });
  }
  res.json({ data: results });
});

exports.streamAudio = asyncHandler(async (req, res) => {
  const selection = await db('audit_selections as a')
    .join('recordings as r', 'a.recording_id', 'r.id')
    .where('a.id', req.params.id)
    .select('r.file_path', 'r.file_name', 'r.file_size', 'a.client_code', 'a.auditor_id', 'a.agent_id')
    .first();

  const err = await checkAccess(selection, req);
  if (err) return res.status(err.status).json(err.body);

  const sftp = new SFTPService();
  const tmpDir = os.tmpdir();
  const tmpInput = path.join(tmpDir, `voxpro_in_${Date.now()}.wav`);
  const tmpOutput = path.join(tmpDir, `voxpro_out_${Date.now()}.wav`);

  try {
    // Archivos locales (Avaya) vs Zoom (API auth) vs HTTP (tiempo real) vs remotos (SFTP)
    if (fs.existsSync(selection.file_path)) {
      fs.copyFileSync(selection.file_path, tmpInput);
    } else if (selection.file_path.includes('zoom.us') || selection.file_path.includes('zoomgov.com')) {
      const audioBuffer = await ZoomAuth.download(selection.file_path);
      fs.writeFileSync(tmpInput, audioBuffer);
    } else if (selection.file_path.startsWith('https://') || selection.file_path.startsWith('http://')) {
      let audioBuffer;
      try {
        audioBuffer = await downloadBuffer(selection.file_path);
      } catch (httpErr) {
        // Fallback SFTP para grabaciones realtime cuyo archivo HTTP no está disponible aún
        const sftpPath = AnalysisService.httpUrlToSftpPath(selection.file_path);
        if (sftpPath) {
          try {
            await sftp.connect();
            audioBuffer = await sftp.getFile(sftpPath);
            await sftp.disconnect();
          } catch {
            await sftp.disconnect().catch(() => {});
          }
        }
        if (!audioBuffer) {
          const e = new Error('El audio aún no está disponible. Las grabaciones del día se sincronizan ~5:00 AM.');
          e.statusCode = 503;
          throw e;
        }
      }
      fs.writeFileSync(tmpInput, audioBuffer);
    } else {
      await sftp.connect();
      const audioBuffer = await sftp.getFile(selection.file_path);
      await sftp.disconnect();
      fs.writeFileSync(tmpInput, audioBuffer);
    }
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
      'Content-Disposition': `inline; filename="${selection.file_name}"`,
      'Cache-Control': 'no-store',
    });
    res.send(converted);
  } catch (err) {
    await sftp.disconnect().catch(() => {});
    throw err;
  } finally {
    try { fs.unlinkSync(tmpInput); } catch {}
    try { fs.unlinkSync(tmpOutput); } catch {}
  }
});

exports.summary = asyncHandler(async (req, res) => {
  const { client_codes: clientCodes, id: userId, role } = req.user;
  const filterUserId = role === 'supervisor_calidad' ? null : userId;
  const result = await AuditService.summary(clientCodes, filterUserId);
  res.json({ data: result });
});
