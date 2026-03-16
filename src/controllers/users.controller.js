const bcrypt = require('bcrypt');
const db = require('../database/connection');
const asyncHandler = require('../middleware/asyncHandler');

const VALID_ROLES = [
  'auditor_obama',
  'auditor_claro',
  'auditor_lv',
  'coordinator_obama',
  'supervisor_calidad',
  'gestor_usuarios',
];

const VALID_CLIENT_CODES = ['obama', 'claro_wcb', 'claro_hogar', 'claro_tyt', 'lv'];

function requireGestor(req, res, next) {
  if (req.user?.role !== 'gestor_usuarios') {
    return res.status(403).json({ error: true, message: 'Se requieren permisos de gestor de usuarios' });
  }
  next();
}

exports.requireGestor = requireGestor;

exports.list = asyncHandler(async (req, res) => {
  const users = await db('users')
    .select('id', 'username', 'name', 'role', 'client_codes', 'active', 'created_at')
    .orderBy('name');

  const parsed = users.map((u) => ({
    ...u,
    client_codes: typeof u.client_codes === 'string' ? JSON.parse(u.client_codes) : u.client_codes,
  }));

  res.json({ data: parsed });
});

exports.create = asyncHandler(async (req, res) => {
  const { username, password, name, role, client_codes, active } = req.body;

  if (!username || !password || !name || !role) {
    return res.status(400).json({ error: true, message: 'username, password, name y role son requeridos' });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: true, message: `Rol inválido. Valores permitidos: ${VALID_ROLES.join(', ')}` });
  }
  if (!Array.isArray(client_codes) || client_codes.length === 0) {
    return res.status(400).json({ error: true, message: 'client_codes debe ser un arreglo no vacío' });
  }
  const invalidCodes = client_codes.filter((c) => !VALID_CLIENT_CODES.includes(c));
  if (invalidCodes.length > 0) {
    return res.status(400).json({ error: true, message: `Códigos de cliente inválidos: ${invalidCodes.join(', ')}` });
  }

  const existing = await db('users').where('username', username).first();
  if (existing) {
    return res.status(409).json({ error: true, message: 'El nombre de usuario ya existe' });
  }

  const password_hash = await bcrypt.hash(password, 10);
  const [id] = await db('users').insert({
    username,
    password_hash,
    name,
    role,
    client_codes: JSON.stringify(client_codes),
    active: active !== false,
  });

  res.status(201).json({ message: 'Usuario creado', data: { id } });
});

exports.update = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { password, name, role, client_codes, active } = req.body;

  const user = await db('users').where('id', id).first();
  if (!user) return res.status(404).json({ error: true, message: 'Usuario no encontrado' });

  if (role && !VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: true, message: `Rol inválido. Valores permitidos: ${VALID_ROLES.join(', ')}` });
  }
  if (client_codes) {
    if (!Array.isArray(client_codes) || client_codes.length === 0) {
      return res.status(400).json({ error: true, message: 'client_codes debe ser un arreglo no vacío' });
    }
    const invalidCodes = client_codes.filter((c) => !VALID_CLIENT_CODES.includes(c));
    if (invalidCodes.length > 0) {
      return res.status(400).json({ error: true, message: `Códigos de cliente inválidos: ${invalidCodes.join(', ')}` });
    }
  }

  const updates = {};
  if (name)         updates.name = name;
  if (role)         updates.role = role;
  if (client_codes) updates.client_codes = JSON.stringify(client_codes);
  if (active !== undefined) updates.active = active;
  if (password)     updates.password_hash = await bcrypt.hash(password, 10);

  await db('users').where('id', id).update(updates);
  res.json({ message: 'Usuario actualizado' });
});

exports.toggleActive = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const user = await db('users').where('id', id).first();
  if (!user) return res.status(404).json({ error: true, message: 'Usuario no encontrado' });

  await db('users').where('id', id).update({ active: !user.active });
  res.json({ message: `Usuario ${!user.active ? 'activado' : 'desactivado'}`, data: { active: !user.active } });
});
