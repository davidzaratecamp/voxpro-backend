const db = require('../database/connection');
const asyncHandler = require('../middleware/asyncHandler');

// Solo formadores y gestores pueden acceder
function requireFormadorOrGestor(req, res, next) {
  const { role } = req.user;
  if (role !== 'formador' && role !== 'gestor_usuarios') {
    return res.status(403).json({ error: true, message: 'Se requiere rol de formador o gestor de usuarios' });
  }
  next();
}

exports.requireFormadorOrGestor = requireFormadorOrGestor;

// GET /api/ojt/agents
// Formador ve solo sus agentes. Gestor puede ver todos (con ?formador_id=X para filtrar).
exports.list = asyncHandler(async (req, res) => {
  const { role, id: userId } = req.user;
  const { status, formador_id } = req.query;

  const query = db('ojt_agents as o')
    .join('users as u', 'o.formador_id', 'u.id')
    .select(
      'o.id',
      'o.nombre_completo',
      'o.cedula',
      'o.client_code',
      'o.aware_source_ids',
      'o.status',
      'o.fecha_ingreso',
      'o.fecha_graduacion',
      'o.notas',
      'o.formador_id',
      'u.name as formador_name',
      'o.created_at'
    )
    .orderBy('o.status', 'asc')
    .orderBy('o.nombre_completo', 'asc');

  // Formador solo ve sus propios agentes
  if (role === 'formador') {
    query.where('o.formador_id', userId);
  } else if (formador_id) {
    query.where('o.formador_id', formador_id);
  }

  if (status) query.where('o.status', status);

  const agents = await query;

  // Enriquecer con folder names para display
  const allSourceIds = [...new Set(agents.flatMap((a) => {
    const ids = typeof a.aware_source_ids === 'string' ? JSON.parse(a.aware_source_ids || '[]') : (a.aware_source_ids || []);
    return ids.map(Number).filter(Boolean);
  }))];

  const sources = allSourceIds.length > 0
    ? await db('aware_sources').whereIn('id', allSourceIds).select('id', 'folder_name')
    : [];
  const sourceMap = Object.fromEntries(sources.map((s) => [s.id, s.folder_name]));

  const result = agents.map((a) => {
    const ids = typeof a.aware_source_ids === 'string' ? JSON.parse(a.aware_source_ids || '[]') : (a.aware_source_ids || []);
    return {
      ...a,
      aware_source_ids: ids.map(Number).filter(Boolean),
      aware_folders: ids.map(Number).filter(Boolean).map((id) => sourceMap[id] || String(id)).join(', '),
    };
  });

  res.json({ data: result });
});

// GET /api/ojt/agents/:id
exports.getById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { role, id: userId } = req.user;

  const agent = await db('ojt_agents as o')
    .join('users as u', 'o.formador_id', 'u.id')
    .where('o.id', id)
    .select('o.*', 'u.name as formador_name')
    .first();

  if (!agent) return res.status(404).json({ error: true, message: 'Agente OJT no encontrado' });

  if (role === 'formador' && agent.formador_id !== userId) {
    return res.status(403).json({ error: true, message: 'Sin acceso a este agente' });
  }

  res.json({ data: agent });
});

// POST /api/ojt/agents
exports.create = asyncHandler(async (req, res) => {
  const { role, id: userId } = req.user;
  const { nombre_completo, cedula, aware_source_ids, client_code, fecha_ingreso, notas } = req.body;

  if (!nombre_completo || !cedula || !aware_source_ids?.length || !client_code || !fecha_ingreso) {
    return res.status(400).json({
      error: true,
      message: 'nombre_completo, cedula, aware_source_ids, client_code y fecha_ingreso son requeridos',
    });
  }
  if (!/^\d+$/.test(String(cedula).trim())) {
    return res.status(400).json({
      error: true,
      message: 'La cédula solo puede contener dígitos numéricos',
    });
  }

  const sourceIds = Array.isArray(aware_source_ids) ? aware_source_ids.map(Number) : [Number(aware_source_ids)];

  // El formador solo puede registrar agentes para sí mismo
  const formadorId = role === 'gestor_usuarios'
    ? (req.body.formador_id || userId)
    : userId;

  // El formador solo puede usar client_codes que tiene autorizados
  if (role === 'formador') {
    const formadorRow = await db('users').where('id', formadorId).select('client_codes').first();
    const allowed = typeof formadorRow.client_codes === 'string'
      ? JSON.parse(formadorRow.client_codes)
      : formadorRow.client_codes;
    if (!allowed.includes(client_code)) {
      return res.status(403).json({
        error: true,
        message: `No tienes autorización para registrar agentes del cliente: ${client_code}`,
      });
    }
  }

  // Verificar que todos los aware_source_ids existen
  const sources = await db('aware_sources').whereIn('id', sourceIds).select('id');
  if (sources.length !== sourceIds.length) {
    return res.status(400).json({ error: true, message: 'Uno o más aware_source_ids son inválidos' });
  }

  // Verificar que no exista ya un registro con la misma cédula para este formador
  const existing = await db('ojt_agents')
    .where({ cedula, formador_id: formadorId })
    .first();
  if (existing) {
    const msg = existing.status === 'activo'
      ? 'Ya existe un agente activo con esa cédula asignado a este formador'
      : 'Ya existe un registro con esa cédula para este formador. Edítalo para reactivarlo.';
    return res.status(409).json({ error: true, message: msg });
  }

  const [id] = await db('ojt_agents').insert({
    formador_id: formadorId,
    nombre_completo: nombre_completo.trim(),
    cedula: cedula.trim(),
    aware_source_ids: JSON.stringify(sourceIds),
    client_code,
    status: 'activo',
    fecha_ingreso,
    notas: notas || null,
  });

  res.status(201).json({ message: 'Agente OJT registrado', data: { id } });
});

// PATCH /api/ojt/agents/:id
// Permite actualizar datos o graduar al agente
exports.update = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { role, id: userId } = req.user;

  const agent = await db('ojt_agents').where('id', id).first();
  if (!agent) return res.status(404).json({ error: true, message: 'Agente OJT no encontrado' });

  if (role === 'formador' && agent.formador_id !== userId) {
    return res.status(403).json({ error: true, message: 'Sin acceso a este agente' });
  }

  const { nombre_completo, cedula, aware_source_ids, client_code, status, fecha_ingreso, fecha_graduacion, notas } = req.body;

  // Formador no puede cambiar el client_code a uno que no tiene autorizado
  if (client_code !== undefined && role === 'formador') {
    const formadorRow = await db('users').where('id', userId).select('client_codes').first();
    const allowed = typeof formadorRow.client_codes === 'string'
      ? JSON.parse(formadorRow.client_codes)
      : formadorRow.client_codes;
    if (!allowed.includes(client_code)) {
      return res.status(403).json({
        error: true,
        message: `No tienes autorización para asignar la campaña: ${client_code}`,
      });
    }
  }

  const updates = { updated_at: db.fn.now() };
  if (nombre_completo   !== undefined) updates.nombre_completo = nombre_completo.trim();
  if (cedula            !== undefined) updates.cedula = cedula.trim();
  if (aware_source_ids  !== undefined) {
    const ids = Array.isArray(aware_source_ids) ? aware_source_ids.map(Number) : [Number(aware_source_ids)];
    updates.aware_source_ids = JSON.stringify(ids);
  }
  if (client_code       !== undefined) updates.client_code = client_code;
  if (fecha_ingreso   !== undefined) updates.fecha_ingreso = fecha_ingreso;
  if (notas           !== undefined) updates.notas = notas;

  // Graduación: registrar fecha automáticamente si no se provee
  if (status === 'graduado') {
    updates.status = 'graduado';
    updates.fecha_graduacion = fecha_graduacion || new Date().toISOString().slice(0, 10);
  } else if (status === 'inactivo') {
    updates.status = 'inactivo';
  } else if (status === 'activo') {
    updates.status = 'activo';
    updates.fecha_graduacion = null;
  }

  await db('ojt_agents').where('id', id).update(updates);
  res.json({ message: 'Agente OJT actualizado' });
});

// GET /api/ojt/aware-sources
// Devuelve aware_sources de grabaciones filtrados por los clientes del usuario (excluye Avaya)
exports.awareSources = asyncHandler(async (req, res) => {
  const clientCodes = req.user.client_codes || [];

  const query = db('aware_sources as s')
    .join('clients as c', 's.client_id', 'c.id')
    .where('s.active', true)
    .whereNot('s.folder_name', 'like', 'AVAYA%')
    .select('s.id', 's.folder_name', 'c.name as client_name', 'c.code as client_code')
    .orderBy('c.name')
    .orderBy('s.folder_name');

  // Gestor ve todos; formador solo ve los de sus clientes
  if (req.user.role !== 'gestor_usuarios' && clientCodes.length > 0) {
    query.whereIn('c.code', clientCodes);
  }

  const sources = await query;
  res.json({ data: sources });
});
