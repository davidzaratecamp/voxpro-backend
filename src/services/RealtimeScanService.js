const { Client: SSHClient } = require('ssh2');
const { Client: PGClient } = require('pg');
const net = require('net');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');
const AWARE_SOURCES = require('../config/sources');

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

/**
 * Descarga un buffer desde una URL HTTPS (Aware usa certs autofirmados).
 */
function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { agent: httpsAgent }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} al descargar ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Abre túnel SSH hacia un host Aware (igual que AwareDBService).
 */
function openTunnel(targetHost, targetPort = 5432) {
  return new Promise((resolve, reject) => {
    const sshClient = new SSHClient();
    const sshCfg = {
      host: config.aware.ssh.host,
      port: config.aware.ssh.port,
      username: config.aware.ssh.username,
    };
    if (config.aware.ssh.privateKey) {
      sshCfg.privateKey = fs.readFileSync(config.aware.ssh.privateKey);
    } else if (config.aware.ssh.password) {
      sshCfg.password = config.aware.ssh.password;
    }

    sshClient.on('ready', () => {
      const server = net.createServer((sock) => {
        sshClient.forwardOut('127.0.0.1', 0, targetHost, targetPort, (err, stream) => {
          if (err) { sock.destroy(); return; }
          sock.pipe(stream);
          stream.pipe(sock);
        });
      });
      server.listen(0, '127.0.0.1', () => {
        resolve({ sshClient, server, port: server.address().port });
      });
      server.on('error', reject);
    });
    sshClient.on('error', reject);
    sshClient.connect(sshCfg);
  });
}

/**
 * Convierte un valor de fecha de pg (puede ser Date object o string) a YYYY-MM-DD.
 */
function toDateStr(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).slice(0, 10);
}

/**
 * Construye la URL de audio para el esquema estándar.
 * Formato: {baseUrl}/{YYYY}/{MM}/{DD}/Q-{phone}-{callId}.WAV
 */
function buildStandardAudioUrl(baseUrl, fecha, phone, callId) {
  const d = new Date(fecha);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${baseUrl}/${yyyy}/${mm}/${dd}/Q-${phone}-${callId}.WAV`;
}

class RealtimeScanService {
  /**
   * Consulta todas las fuentes Aware para una fecha y devuelve las llamadas.
   * Filtra por clientCodes que el usuario tiene acceso.
   *
   * @param {string} date - YYYY-MM-DD (default: hoy)
   * @param {string[]} clientCodes - Códigos de cliente del usuario
   * @returns {object[]} Lista de llamadas del día
   */
  async getCalls(date, clientCodes = []) {
    const targetDate = date || new Date().toISOString().slice(0, 10);

    // Agrupar fuentes únicas por host+database para no abrir túneles duplicados
    const seen = new Set();
    const sourcesToQuery = [];
    for (const src of AWARE_SOURCES) {
      if (clientCodes.length && !clientCodes.includes(src.clientCode)) continue;
      const key = `${src.db.host}:${src.db.database}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sourcesToQuery.push(src);
    }

    const allCalls = [];

    for (const src of sourcesToQuery) {
      let tunnel = null;
      let pgClient = null;
      try {
        tunnel = await openTunnel(src.db.host, src.db.port);
        pgClient = new PGClient({
          host: '127.0.0.1',
          port: tunnel.port,
          database: src.db.database,
          user: src.db.user,
          password: src.db.password,
          statement_timeout: 30000,
        });
        await pgClient.connect();

        let rows;
        if (src.schema === 'awareccm') {
          const result = await pgClient.query(
            `SELECT
               rl.registro_llamada_id,
               rl.agente_id::text      AS agent_id,
               rl.json_data->>'agente' AS agent_name,
               rl.time_speaking        AS duration,
               rl.registro_llamada_fecha AS file_date,
               rl.proyecto_id,
               rl.audiofile,
               rl.hangup_src
             FROM registro_llamada rl
             WHERE rl.registro_llamada_fecha = $1
               AND rl.agente_id IS NOT NULL
               AND rl.time_speaking > 0
               AND rl.audiofile IS NOT NULL
             ORDER BY rl.registro_llamada_id DESC`,
            [targetDate],
          );
          rows = result.rows.map((r) => ({
            sourceKey:           `${src.db.host}:${src.db.database}`,
            folder:              src.folder,
            clientCode:          src.clientCode,
            clientName:          src.clientName,
            schema:              src.schema,
            audioBaseUrl:        src.audioBaseUrl,
            registro_llamada_id: r.registro_llamada_id,
            agent_id:            r.agent_id,
            agent_name:          r.agent_name,
            duration:            r.duration,
            file_date:           toDateStr(r.file_date),
            proyecto_id:         r.proyecto_id,
            hangup_src:          r.hangup_src,
            audio_url:           `${src.audioBaseUrl}/${r.audiofile}.WAV`,
            file_name:           `${r.audiofile}.WAV`.split('/').pop(),
          }));
        } else {
          const result = await pgClient.query(
            `SELECT
               rl.registro_llamada_id,
               rl.agente_id::text          AS agent_id,
               e.empleado_name             AS agent_name,
               rl.call_time                AS duration,
               rl.registro_llamada_fecha   AS file_date,
               rl.proyecto_id,
               rl.registro_llamada_fono    AS phone,
               rl.call_id,
               rl.uniqueid
             FROM registro_llamada rl
             LEFT JOIN empleado e ON rl.agente_id = e.empleado_rut
             WHERE rl.registro_llamada_fecha = $1
               AND rl.agente_id IS NOT NULL
               AND rl.call_time > 0
               AND rl.call_id > 0
             ORDER BY rl.registro_llamada_id DESC`,
            [targetDate],
          );
          rows = result.rows.map((r) => {
            const audioUrl = buildStandardAudioUrl(
              src.audioBaseUrl,
              r.file_date,
              r.phone,
              r.call_id,
            );
            return {
              sourceKey:           `${src.db.host}:${src.db.database}`,
              folder:              src.folder,
              clientCode:          src.clientCode,
              clientName:          src.clientName,
              schema:              src.schema,
              audioBaseUrl:        src.audioBaseUrl,
              registro_llamada_id: r.registro_llamada_id,
              agent_id:            r.agent_id,
              agent_name:          r.agent_name,
              duration:            r.duration,
              file_date:           toDateStr(r.file_date),
              proyecto_id:         r.proyecto_id,
              hangup_src:          null,
              audio_url:           audioUrl,
              file_name:           audioUrl.split('/').pop(),
            };
          });
        }

        logger.info(`Realtime ${src.folder}: ${rows.length} llamadas para ${targetDate}`);
        allCalls.push(...rows);
      } catch (err) {
        logger.error(`Realtime scan error en ${src.folder}`, { message: err.message });
      } finally {
        if (pgClient) await pgClient.end().catch(() => {});
        if (tunnel) { tunnel.server.close(); tunnel.sshClient.end(); }
      }
    }

    return allCalls;
  }

  /**
   * Obtiene las llamadas de UN agente en una fecha, filtradas >60s, ordenadas por duración desc.
   * Abre los túneles en paralelo para mayor velocidad.
   */
  async getCallsByAgent(date, agentId, clientCodes = []) {
    const targetDate = date || new Date().toISOString().slice(0, 10);

    const seen = new Set();
    const sourcesToQuery = [];
    for (const src of AWARE_SOURCES) {
      if (clientCodes.length && !clientCodes.includes(src.clientCode)) continue;
      const key = `${src.db.host}:${src.db.database}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sourcesToQuery.push(src);
    }

    const results = await Promise.allSettled(
      sourcesToQuery.map(async (src) => {
        let tunnel = null;
        let pgClient = null;
        try {
          tunnel = await openTunnel(src.db.host, src.db.port);
          pgClient = new PGClient({
            host: '127.0.0.1',
            port: tunnel.port,
            database: src.db.database,
            user: src.db.user,
            password: src.db.password,
            statement_timeout: 30000,
          });
          await pgClient.connect();

          let rows;
          if (src.schema === 'awareccm') {
            const result = await pgClient.query(
              `SELECT
                 rl.registro_llamada_id,
                 rl.agente_id::text      AS agent_id,
                 rl.json_data->>'agente' AS agent_name,
                 rl.time_speaking        AS duration,
                 rl.registro_llamada_fecha AS file_date,
                 rl.proyecto_id,
                 rl.audiofile,
                 rl.hangup_src
               FROM registro_llamada rl
               WHERE rl.registro_llamada_fecha = $1
                 AND rl.agente_id::text = $2
                 AND rl.time_speaking > 120
                 AND rl.audiofile IS NOT NULL
               ORDER BY rl.time_speaking DESC`,
              [targetDate, String(agentId)],
            );
            rows = result.rows.map((r) => ({
              sourceKey:           `${src.db.host}:${src.db.database}`,
              folder:              src.folder,
              clientCode:          src.clientCode,
              clientName:          src.clientName,
              schema:              src.schema,
              audioBaseUrl:        src.audioBaseUrl,
              registro_llamada_id: r.registro_llamada_id,
              agent_id:            r.agent_id,
              agent_name:          r.agent_name,
              duration:            r.duration,
              file_date:           toDateStr(r.file_date),
              proyecto_id:         r.proyecto_id,
              hangup_src:          r.hangup_src,
              call_phone:          null,
              audio_url:           `${src.audioBaseUrl}/${r.audiofile}.WAV`,
              file_name:           `${r.audiofile}.WAV`.split('/').pop(),
            }));
          } else {
            const result = await pgClient.query(
              `SELECT
                 rl.registro_llamada_id,
                 rl.agente_id::text          AS agent_id,
                 e.empleado_name             AS agent_name,
                 rl.call_time                AS duration,
                 rl.registro_llamada_fecha   AS file_date,
                 rl.proyecto_id,
                 rl.registro_llamada_fono    AS phone,
                 rl.call_id
               FROM registro_llamada rl
               LEFT JOIN empleado e ON rl.agente_id = e.empleado_rut
               WHERE rl.registro_llamada_fecha = $1
                 AND rl.agente_id::text = $2
                 AND rl.call_time > 120
                 AND rl.call_id > 0
               ORDER BY rl.call_time DESC`,
              [targetDate, String(agentId)],
            );
            rows = result.rows.map((r) => {
              const audioUrl = buildStandardAudioUrl(src.audioBaseUrl, r.file_date, r.phone, r.call_id);
              return {
                sourceKey:           `${src.db.host}:${src.db.database}`,
                folder:              src.folder,
                clientCode:          src.clientCode,
                clientName:          src.clientName,
                schema:              src.schema,
                audioBaseUrl:        src.audioBaseUrl,
                registro_llamada_id: r.registro_llamada_id,
                agent_id:            r.agent_id,
                agent_name:          r.agent_name,
                duration:            r.duration,
                file_date:           toDateStr(r.file_date),
                proyecto_id:         r.proyecto_id,
                hangup_src:          null,
                call_phone:          r.phone,
                audio_url:           audioUrl,
                file_name:           audioUrl.split('/').pop(),
              };
            });
          }
          return rows;
        } finally {
          if (pgClient) await pgClient.end().catch(() => {});
          if (tunnel) { tunnel.server.close(); tunnel.sshClient.end(); }
        }
      }),
    );

    const allCalls = [];
    for (const r of results) {
      if (r.status === 'fulfilled') allCalls.push(...r.value);
      else logger.error('getCallsByAgent error', { message: r.reason?.message });
    }

    return allCalls
      .sort((a, b) => (b.duration || 0) - (a.duration || 0))
      .slice(0, 10);
  }

  /**
   * Busca llamadas en Kraken por número de teléfono para una fecha dada.
   * Solo fuentes con schema estándar (awareccm no tiene campo de teléfono).
   */
  async getCallsByPhone(date, phone, clientCodes = []) {
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const phonePattern = `%${phone.replace(/\D/g, '')}%`;

    const seen = new Set();
    const sourcesToQuery = [];
    for (const src of AWARE_SOURCES) {
      if (src.schema === 'awareccm') continue;
      if (clientCodes.length && !clientCodes.includes(src.clientCode)) continue;
      const key = `${src.db.host}:${src.db.database}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sourcesToQuery.push(src);
    }

    const results = await Promise.allSettled(
      sourcesToQuery.map(async (src) => {
        let tunnel = null;
        let pgClient = null;
        try {
          tunnel = await openTunnel(src.db.host, src.db.port);
          pgClient = new PGClient({
            host: '127.0.0.1',
            port: tunnel.port,
            database: src.db.database,
            user: src.db.user,
            password: src.db.password,
            statement_timeout: 30000,
          });
          await pgClient.connect();

          const result = await pgClient.query(
            `SELECT
               rl.registro_llamada_id,
               rl.agente_id::text          AS agent_id,
               e.empleado_name             AS agent_name,
               rl.call_time                AS duration,
               rl.registro_llamada_fecha   AS file_date,
               rl.proyecto_id,
               rl.registro_llamada_fono    AS phone,
               rl.call_id
             FROM registro_llamada rl
             LEFT JOIN empleado e ON rl.agente_id = e.empleado_rut
             WHERE rl.registro_llamada_fecha = $1
               AND rl.registro_llamada_fono LIKE $2
               AND rl.call_time > 0
               AND rl.call_id > 0
             ORDER BY rl.call_time DESC
             LIMIT 20`,
            [targetDate, phonePattern],
          );

          return result.rows.map((r) => {
            const audioUrl = buildStandardAudioUrl(src.audioBaseUrl, r.file_date, r.phone, r.call_id);
            return {
              sourceKey:           `${src.db.host}:${src.db.database}`,
              folder:              src.folder,
              clientCode:          src.clientCode,
              clientName:          src.clientName,
              schema:              src.schema,
              audioBaseUrl:        src.audioBaseUrl,
              registro_llamada_id: r.registro_llamada_id,
              agent_id:            r.agent_id,
              agent_name:          r.agent_name,
              duration:            r.duration,
              file_date:           toDateStr(r.file_date),
              proyecto_id:         r.proyecto_id,
              hangup_src:          null,
              call_phone:          r.phone,
              audio_url:           audioUrl,
              file_name:           audioUrl.split('/').pop(),
            };
          });
        } finally {
          if (pgClient) await pgClient.end().catch(() => {});
          if (tunnel) { tunnel.server.close(); tunnel.sshClient.end(); }
        }
      }),
    );

    const allCalls = [];
    for (const r of results) {
      if (r.status === 'fulfilled') allCalls.push(...r.value);
      else logger.error('getCallsByPhone error', { message: r.reason?.message });
    }

    return allCalls.sort((a, b) => (b.duration || 0) - (a.duration || 0));
  }

  /**
   * Descarga el audio de una URL HTTPS de Aware.
   */
  async downloadAudio(audioUrl) {
    return downloadBuffer(audioUrl);
  }
}

module.exports = new RealtimeScanService();
module.exports.downloadBuffer = downloadBuffer;
module.exports.httpsAgent = httpsAgent;
