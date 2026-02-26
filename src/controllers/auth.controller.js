const AuthService = require('../services/AuthService');
const asyncHandler = require('../middleware/asyncHandler');

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
  res.json({ data: req.user });
});
