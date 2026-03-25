const AuthService = require('../services/AuthService');
const asyncHandler = require('../middleware/asyncHandler');
const db = require('../database/connection');

exports.login = asyncHandler(async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      error: true,
      message: 'Username y password son requeridos',
    });
  }

  const result = await AuthService.login(username, password);
  if (!result) {
    return res.status(401).json({
      error: true,
      message: 'Credenciales inválidas',
    });
  }

  res.json({ data: result });
});

exports.me = asyncHandler(async (req, res) => {
  const user = await db('users')
    .where({ id: req.user.id, active: true })
    .select('id', 'username', 'name', 'role', 'client_codes')
    .first();

  if (!user) {
    return res.status(401).json({ error: true, message: 'Usuario no encontrado' });
  }

  const clientCodes = typeof user.client_codes === 'string'
    ? JSON.parse(user.client_codes)
    : user.client_codes;

  res.json({ data: { ...user, client_codes: clientCodes } });
});
