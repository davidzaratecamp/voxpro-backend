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
    .join('aware_sources as s', 'o.aware_source_id', 's.id')
    .join('users as u', 'o.formador_id', 'u.id')
    .select(
      'o.id',
      'o.nombre_completo',
      'o.cedula',
      'o.client_code',
      'o.aware_source_id',
      's.folder as aware_folder',
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
  res.json({ data: agents });
});

// GET /api/ojt/agents/:id
exports.getById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { role, id: userId } = req.user;

  const agent = await db('ojt_agents as o')
    .join('aware_sources as s', 'o.aware_source_id', 's.id')
    .join('users as u', 'o.formador_id', 'u.id')
    .where('o.id', id)
    .select(
      'o.*',
      's.folder as aware_folder',
      'u.name as formador_name'
    )
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
  const { nombre_completo, cedula, aware_source_id, client_code, fecha_ingreso, notas } = req.body;

  if (!nombre_completo || !cedula || !aware_source_id || !client_code || !fecha_ingreso) {
    return res.status(400).json({
      error: true,
      message: 'nombre_completo, cedula, aware_source_id, client_code y fecha_ingreso son requeridos',
    });
  }

  // El formador solo puede registrar agentes para sí mismo
  const formadorId = role === 'gestor_usuarios'
    ? (req.body.formador_id || userId)
    : userId;

  // Verificar que el aware_source_id existe
  const source = await db('aware_sources').where('id', aware_source_id).first();
  if (!source) {
    return res.status(400).json({ error: true, message: 'aware_source_id inválido' });
  }

  // Verificar que no haya un agente activo con la misma cédula para este formador
  const existing = await db('ojt_agents')
    .where({ cedula, formador_id: formadorId, status: 'activo' })
    .first();
  if (existing) {
    return res.status(409).json({
      error: true,
      message: 'Ya existe un agente activo con esa cédula asignado a este formador',
    });
  }

  const [id] = await db('ojt_agents').insert({
    formador_id: formadorId,
    nombre_completo: nombre_completo.trim(),
    cedula: cedula.trim(),
    aware_source_id,
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

  const { nombre_completo, cedula, aware_source_id, client_code, status, fecha_ingreso, fecha_graduacion, notas } = req.body;

  const updates = { updated_at: db.fn.now() };
  if (nombre_completo !== undefined) updates.nombre_completo = nombre_completo.trim();
  if (cedula          !== undefined) updates.cedula = cedula.trim();
  if (aware_source_id !== undefined) updates.aware_source_id = aware_source_id;
  if (client_code     !== undefined) updates.client_code = client_code;
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
// Devuelve todos los aware_sources para el dropdown del formulario
exports.awareSources = asyncHandler(async (req, res) => {
  const sources = await db('aware_sources as s')
    .join('clients as c', 's.client_id', 'c.id')
    .select('s.id', 's.folder', 'c.name as client_name', 'c.code as client_code')
    .orderBy('s.folder');

  res.json({ data: sources });
});
