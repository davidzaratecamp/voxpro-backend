const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../database/connection');
const asyncHandler = require('../middleware/asyncHandler');

// ── Directorio de uploads ────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '../../uploads/avaya');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── Multer config ────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const date = req.body.file_date || new Date().toISOString().slice(0, 10);
    const [year, month, day] = date.split('-');
    const dir = path.join(UPLOAD_DIR, year, month, day);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '_' + Math.round(Math.random() * 1e6);
    const ext = path.extname(file.originalname);
    cb(null, unique + ext);
  },
});

exports.upload = multer({
  storage,
  limits: { fileSize: 300 * 1024 * 1024 }, // 300 MB
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function getWeekBounds(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const ref = new Date(Date.UTC(y, m - 1, d));
  const day = ref.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(ref);
  monday.setUTCDate(ref.getUTCDate() - diff);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    weekStart: monday.toISOString().slice(0, 10),
    weekEnd: sunday.toISOString().slice(0, 10),
  };
}

function getWeekStart(dateStr) {
  return getWeekBounds(dateStr).weekStart;
}

// ── Agentes ──────────────────────────────────────────────────────────────────

// GET /api/avaya/agents
exports.listAgents = asyncHandler(async (req, res) => {
  const agents = await db('avaya_agents')
    .where('coordinator_id', req.user.id)
    .orderBy('status', 'asc')
    .orderBy('nombre_completo', 'asc');
  res.json({ data: agents });
});

// POST /api/avaya/agents
exports.createAgent = asyncHandler(async (req, res) => {
  const { nombre_completo, cedula, client_code, notas } = req.body;

  if (!nombre_completo || !cedula || !client_code) {
    return res.status(400).json({ error: true, message: 'nombre_completo, cedula y client_code son requeridos' });
  }
  if (!/^\d+$/.test(String(cedula).trim())) {
    return res.status(400).json({ error: true, message: 'La cédula solo puede contener dígitos numéricos' });
  }

  const existing = await db('avaya_agents')
    .where({ coordinator_id: req.user.id, cedula: cedula.trim(), status: 'activo' })
    .first();
  if (existing) {
    return res.status(409).json({ error: true, message: 'Ya existe un agente activo con esa cédula' });
  }

  const [id] = await db('avaya_agents').insert({
    coordinator_id: req.user.id,
    nombre_completo: nombre_completo.trim(),
    cedula: cedula.trim(),
    client_code,
    status: 'activo',
    notas: notas || null,
  });

  res.status(201).json({ message: 'Agente registrado', data: { id } });
});

// PATCH /api/avaya/agents/:id
exports.updateAgent = asyncHandler(async (req, res) => {
  const agent = await db('avaya_agents')
    .where({ id: req.params.id, coordinator_id: req.user.id })
    .first();
  if (!agent) return res.status(404).json({ error: true, message: 'Agente no encontrado' });

  const { nombre_completo, cedula, status, notas } = req.body;
  const updates = { updated_at: db.fn.now() };
  if (nombre_completo !== undefined) updates.nombre_completo = nombre_completo.trim();
  if (cedula !== undefined) updates.cedula = String(cedula).trim();
  if (status !== undefined) updates.status = status;
  if (notas !== undefined) updates.notas = notas;

  await db('avaya_agents').where('id', req.params.id).update(updates);
  res.json({ message: 'Agente actualizado' });
});

// ── Grabaciones ───────────────────────────────────────────────────────────────

// POST /api/avaya/recordings/upload
// multipart/form-data: file (audio), agent_id, file_date (YYYY-MM-DD)
exports.uploadRecording = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: true, message: 'No se recibió ningún archivo de audio' });
  }

  const { agent_id, file_date } = req.body;
  if (!agent_id || !file_date) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: true, message: 'agent_id y file_date son requeridos' });
  }

  // Verificar agente
  const agent = await db('avaya_agents')
    .where({ id: agent_id, coordinator_id: req.user.id, status: 'activo' })
    .first();
  if (!agent) {
    fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: true, message: 'Agente no encontrado o inactivo' });
  }

  // Obtener fuente Avaya para el cliente del agente
  const source = await db('aware_sources as s')
    .join('clients as c', 's.client_id', 'c.id')
    .where('c.code', agent.client_code)
    .where('s.folder_name', 'like', 'AVAYA_%')
    .select('s.id')
    .first();

  if (!source) {
    fs.unlinkSync(req.file.path);
    return res.status(500).json({ error: true, message: 'Fuente Avaya no configurada para este cliente' });
  }

  const { weekStart, weekEnd } = getWeekBounds(file_date);
  const filePath = req.file.path;
  const pathHash = crypto.createHash('sha256').update(filePath).digest('hex');

  // Insertar grabación
  const [recordingId] = await db('recordings').insert({
    aware_source_id: source.id,
    file_name: req.file.originalname,
    file_path: filePath,
    file_path_hash: pathHash,
    file_size: req.file.size,
    file_date,
    agent_id: agent.cedula,
    agent_name: agent.nombre_completo,
    agent_enriched: true,
    status: 'pending',
  });

  // Crear selección de auditoría
  const [selectionId] = await db('audit_selections').insert({
    recording_id: recordingId,
    auditor_id: req.user.id,
    agent_id: agent.cedula,
    agent_name: agent.nombre_completo,
    client_code: agent.client_code,
    week_start: weekStart,
    week_end: weekEnd,
    status: 'selected',
    score: 0,
  });

  res.status(201).json({
    message: 'Grabación cargada correctamente',
    data: { recording_id: recordingId, selection_id: selectionId },
  });
});

// GET /api/avaya/recordings?week_start=YYYY-MM-DD&status=
exports.getRecordings = asyncHandler(async (req, res) => {
  const { week_start, status } = req.query;
  const weekStart = week_start ? getWeekStart(week_start) : getWeekStart(new Date().toISOString().slice(0, 10));

  const query = db('audit_selections as a')
    .join('recordings as r', 'r.id', 'a.recording_id')
    .join('aware_sources as s', 'r.aware_source_id', 's.id')
    .where('a.auditor_id', req.user.id)
    .where('a.week_start', weekStart)
    .where('s.folder_name', 'like', 'AVAYA_%')
    .select(
      'a.id as selection_id',
      'a.status',
      'a.score',
      'a.notes',
      'a.agent_id',
      'a.agent_name',
      'a.client_code',
      'a.week_start',
      'r.id as recording_id',
      'r.file_name',
      'r.file_date',
      'r.file_size',
      'r.call_duration'
    )
    .orderBy('r.file_date', 'desc')
    .orderBy('a.agent_name', 'asc');

  if (status) query.where('a.status', status);

  const rows = await query;
  res.json({ data: rows });
});
