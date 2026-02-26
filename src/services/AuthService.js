const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../database/connection');
const config = require('../config');

class AuthService {
  async login(username, password) {
    const user = await db('users')
      .where({ username, active: true })
      .first();

    if (!user) {
      return null;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return null;
    }

    const clientCodes = typeof user.client_codes === 'string'
      ? JSON.parse(user.client_codes)
      : user.client_codes;

    const payload = {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      client_codes: clientCodes,
    };

    const token = jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn,
    });

    return { token, user: payload };
  }

  verifyToken(token) {
    return jwt.verify(token, config.jwt.secret);
  }
}

module.exports = new AuthService();
