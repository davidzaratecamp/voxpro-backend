const AuthService = require('../services/AuthService');

const auth = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: true, message: 'Token requerido' });
  }

  const token = header.slice(7);

  try {
    const payload = AuthService.verifyToken(token);
    req.user = {
      id: payload.id,
      username: payload.username,
      name: payload.name,
      role: payload.role,
      client_codes: payload.client_codes,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: true, message: 'Token inválido o expirado' });
  }
};

module.exports = auth;
