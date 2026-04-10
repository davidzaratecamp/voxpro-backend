const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Maneja la autenticación Server-to-Server OAuth con Zoom.
 * Cachea el token en memoria y lo renueva automáticamente antes de que expire.
 */
class ZoomAuthService {
  constructor() {
    this._token = null;
    this._expiresAt = 0;
  }

  /**
   * Devuelve un token válido, renovando si está por expirar.
   */
  async getToken() {
    // Renovar 60 segundos antes de expirar
    if (this._token && Date.now() < this._expiresAt - 60_000) {
      return this._token;
    }

    const accountId    = process.env.ZOOM_ACCOUNT_ID;
    const clientId     = process.env.ZOOM_CLIENT_ID;
    const clientSecret = process.env.ZOOM_CLIENT_SECRET;

    if (!accountId || !clientId || !clientSecret) {
      throw new Error('Credenciales Zoom no configuradas (ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET)');
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await axios.post(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
      null,
      { headers: { Authorization: `Basic ${credentials}` } }
    );

    this._token     = response.data.access_token;
    this._expiresAt = Date.now() + response.data.expires_in * 1000;

    logger.info('Zoom: token renovado');
    return this._token;
  }

  /**
   * Descarga un archivo desde una URL de Zoom autenticando con Bearer token.
   * @returns {Buffer}
   */
  async download(url) {
    const token = await this.getToken();
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
      maxRedirects: 5,
    });
    return Buffer.from(response.data);
  }

  /**
   * Hace GET a la API de Zoom con token automático.
   */
  async get(path, params = {}) {
    const token = await this.getToken();
    const response = await axios.get(`https://api.zoom.us/v2${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      params,
    });
    return response.data;
  }
}

module.exports = new ZoomAuthService();
