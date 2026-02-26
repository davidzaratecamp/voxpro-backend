const SftpClient = require('ssh2-sftp-client');
const fs = require('fs');
const config = require('../config');
const logger = require('../utils/logger');

class SFTPService {
  constructor() {
    this.client = null;
  }

  /**
   * Abre conexión SFTP al servidor Aware.
   * Soporta autenticación por password o llave SSH.
   */
  async connect() {
    this.client = new SftpClient('voxpro');

    const sshConfig = {
      host: config.aware.ssh.host,
      port: config.aware.ssh.port,
      username: config.aware.ssh.username,
    };

    // Autenticación por llave SSH (preferida) o password
    if (config.aware.ssh.privateKey) {
      sshConfig.privateKey = fs.readFileSync(config.aware.ssh.privateKey);
    } else if (config.aware.ssh.password) {
      sshConfig.password = config.aware.ssh.password;
    }
    // Si no hay ni password ni key, intenta agent (ssh-agent del sistema)

    try {
      await this.client.connect(sshConfig);
      logger.info(`SFTP conectado a ${sshConfig.host}`);
    } catch (err) {
      logger.error(`Error conectando SFTP a ${sshConfig.host}`, err);
      this.client = null;
      throw err;
    }

    return this.client;
  }

  /**
   * Cierra la conexión SFTP.
   */
  async disconnect() {
    if (this.client) {
      try {
        await this.client.end();
      } catch {
        // Ignorar errores al cerrar
      }
      this.client = null;
      logger.info('SFTP desconectado');
    }
  }

  /**
   * Lista archivos en un directorio remoto (sin recursión).
   * Retorna solo archivos (no directorios).
   */
  async listFiles(remotePath) {
    this._ensureConnected();
    try {
      const list = await this.client.list(remotePath);
      return list.filter((item) => item.type === '-');
    } catch (err) {
      if (err.code === 2) return []; // No such file/directory
      throw err;
    }
  }

  /**
   * Lista subdirectorios en un directorio remoto.
   */
  async listDirs(remotePath) {
    this._ensureConnected();
    try {
      const list = await this.client.list(remotePath);
      return list
        .filter((item) => item.type === 'd' && item.name !== '.' && item.name !== '..')
        .map((item) => item.name);
    } catch (err) {
      if (err.code === 2) return [];
      throw err;
    }
  }

  /**
   * Verifica si un directorio remoto existe.
   */
  async exists(remotePath) {
    this._ensureConnected();
    try {
      return await this.client.exists(remotePath);
    } catch {
      return false;
    }
  }

  /**
   * Obtiene stat de un archivo remoto.
   */
  async stat(remotePath) {
    this._ensureConnected();
    return this.client.stat(remotePath);
  }

  /**
   * Descarga un archivo remoto y retorna su contenido como Buffer.
   */
  async getFile(remotePath) {
    this._ensureConnected();
    return this.client.get(remotePath);
  }

  _ensureConnected() {
    if (!this.client) {
      throw new Error('SFTP no conectado. Llama a connect() primero.');
    }
  }
}

module.exports = SFTPService;
