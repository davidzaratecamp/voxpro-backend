const { Client: SSHClient } = require('ssh2');
const { Client: PGClient } = require('pg');
const net = require('net');
const fs = require('fs');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Servicio para consultar las bases de datos PostgreSQL de los servidores Aware.
 * Se conecta vía túnel SSH a través de Kraken (solo lectura).
 *
 * Flujo: VoxPro → SSH Kraken → PostgreSQL Aware (solo SELECT)
 */
class AwareDBService {
  /**
   * Consulta datos de llamadas y agentes para un conjunto de grabaciones.
   *
   * @param {object} sourceConfig - Config de la fuente Aware (de sources.js)
   * @param {Array} recordings - Grabaciones a enriquecer [{call_id, file_date, ...}]
   * @returns {Map} call_id → {agent_id, agent_name, agent_extension, call_duration}
   */
  async enrichRecordings(sourceConfig, recordings) {
    if (!recordings.length) return new Map();

    const callIds = recordings
      .map((r) => r.call_id)
      .filter((id) => id != null);

    if (!callIds.length) return new Map();

    // Obtener fechas únicas como strings YYYY-MM-DD para filtrar la consulta
    const dateStrings = new Set();
    for (const r of recordings) {
      if (r.file_date) {
        const d = r.file_date instanceof Date ? r.file_date.toISOString().slice(0, 10) : String(r.file_date).slice(0, 10);
        dateStrings.add(d);
      }
    }
    const dates = [...dateStrings];

    let pgClient;
    let sshClient;
    let localServer;

    try {
      const tunnel = await this._openTunnel(sourceConfig.db);
      sshClient = tunnel.sshClient;
      localServer = tunnel.localServer;
      const localPort = tunnel.localPort;

      pgClient = new PGClient({
        host: '127.0.0.1',
        port: localPort,
        database: sourceConfig.db.database,
        user: sourceConfig.db.user,
        password: sourceConfig.db.password,
        statement_timeout: 30000,
      });

      await pgClient.connect();

      const agentMap = new Map();

      if (sourceConfig.schema === 'awareccm') {
        // AWARE_34: tabla usuario, campos distintos, call_id es string
        // No tiene queue_log → hangup_by queda null
        const query = `
          SELECT rl.call_id::text AS call_id,
                 rl.agente_id AS agent_id,
                 u.user_fullname AS agent_name,
                 u.extension AS agent_extension,
                 rl.time_speaking AS call_duration
          FROM registro_llamada rl
          LEFT JOIN usuario u ON rl.agente_id = u.user_id
          WHERE rl.call_id::text = ANY($1::text[])
            AND rl.registro_llamada_fecha = ANY($2::date[])
        `;
        const result = await pgClient.query(query, [callIds.map(String), dates]);
        for (const row of result.rows) {
          agentMap.set(String(row.call_id), this._formatAgent(row));
        }
      } else {
        // Standard: tabla empleado.
        // Separar call_ids numéricos (buscar por call_id) de dot-notation (buscar por uniqueid)
        const numericIds = callIds
          .filter((id) => /^\d+$/.test(String(id)))
          .map((id) => parseInt(id));

        const dotIds = callIds
          .filter((id) => /^\d+\.\d+$/.test(String(id)))
          .map(String);

        const uniqueidToCallId = new Map();

        // Búsqueda por call_id numérico (Obama y otros proyectos con call_id real)
        if (numericIds.length > 0) {
          const query = `
            SELECT rl.call_id::text AS call_id,
                   rl.agente_id::text AS agent_id,
                   e.empleado_name AS agent_name,
                   e.empleado_ext AS agent_extension,
                   rl.call_time AS call_duration,
                   rl.uniqueid,
                   rl.proyecto_id
            FROM registro_llamada rl
            LEFT JOIN empleado e ON rl.agente_id = e.empleado_rut
            WHERE rl.call_id = ANY($1::int[])
              AND rl.registro_llamada_fecha = ANY($2::date[])
          `;
          const result = await pgClient.query(query, [numericIds, dates]);

          for (const row of result.rows) {
            agentMap.set(String(row.call_id), this._formatAgent(row));
            if (row.uniqueid) {
              uniqueidToCallId.set(row.uniqueid, String(row.call_id));
            }
          }
        }

        // Búsqueda por uniqueid dot-notation (LV y otros proyectos con call_id=0)
        if (dotIds.length > 0) {
          const query = `
            SELECT rl.uniqueid AS call_id,
                   rl.agente_id::text AS agent_id,
                   e.empleado_name AS agent_name,
                   e.empleado_ext AS agent_extension,
                   rl.call_time AS call_duration,
                   rl.uniqueid,
                   rl.proyecto_id
            FROM registro_llamada rl
            LEFT JOIN empleado e ON rl.agente_id = e.empleado_rut
            WHERE rl.uniqueid = ANY($1::text[])
              AND rl.registro_llamada_fecha = ANY($2::date[])
          `;
          const result = await pgClient.query(query, [dotIds, dates]);

          for (const row of result.rows) {
            agentMap.set(String(row.call_id), this._formatAgent(row));
            if (row.uniqueid) {
              uniqueidToCallId.set(row.uniqueid, String(row.call_id));
            }
          }
        }

        // Consultar queue_log para saber quién colgó
        if (uniqueidToCallId.size > 0) {
          await this._enrichHangupBy(pgClient, uniqueidToCallId, agentMap);
        }
      }

      logger.info(
        `AwareDB ${sourceConfig.folder}: ${agentMap.size}/${callIds.length} llamadas enriquecidas`
      );

      return agentMap;
    } catch (err) {
      logger.error(`AwareDB ${sourceConfig.folder}: error consultando`, err);
      return new Map();
    } finally {
      if (pgClient) await pgClient.end().catch(() => {});
      if (localServer) localServer.close();
      if (sshClient) sshClient.end();
    }
  }

  /**
   * Abre un túnel SSH a través de Kraken hacia el PostgreSQL del Aware.
   * Retorna un puerto local temporal donde escucha el túnel.
   */
  _openTunnel(dbConfig) {
    return new Promise((resolve, reject) => {
      const sshClient = new SSHClient();
      const sshConfig = {
        host: config.aware.ssh.host,
        port: config.aware.ssh.port,
        username: config.aware.ssh.username,
      };

      if (config.aware.ssh.privateKey) {
        sshConfig.privateKey = fs.readFileSync(config.aware.ssh.privateKey);
      } else if (config.aware.ssh.password) {
        sshConfig.password = config.aware.ssh.password;
      }

      sshClient.on('ready', () => {
        // Crear servidor TCP local que reenvía al PostgreSQL remoto
        const localServer = net.createServer((socket) => {
          sshClient.forwardOut(
            '127.0.0.1',
            0,
            dbConfig.host,
            dbConfig.port,
            (err, stream) => {
              if (err) {
                socket.end();
                return;
              }
              socket.pipe(stream).pipe(socket);
            }
          );
        });

        // Escuchar en puerto aleatorio
        localServer.listen(0, '127.0.0.1', () => {
          const localPort = localServer.address().port;
          resolve({ sshClient, localServer, localPort });
        });
      });

      sshClient.on('error', reject);
      sshClient.connect(sshConfig);
    });
  }

  /**
   * Consulta queue_log para determinar quién colgó cada llamada.
   * COMPLETECALLER = colgó el cliente, COMPLETEAGENT = colgó el agente.
   */
  async _enrichHangupBy(pgClient, uniqueidToCallId, agentMap) {
    const uniqueids = [...uniqueidToCallId.keys()];

    try {
      const query = `
        SELECT callid, event, data2 AS talk_time
        FROM queue_log
        WHERE callid = ANY($1::text[])
          AND event IN ('COMPLETECALLER', 'COMPLETEAGENT')
      `;
      const result = await pgClient.query(query, [uniqueids]);

      for (const row of result.rows) {
        const callId = uniqueidToCallId.get(row.callid);
        if (callId && agentMap.has(callId)) {
          const data = agentMap.get(callId);
          data.hangup_by = row.event === 'COMPLETECALLER' ? 'caller' : 'agent';
          // data2 = talk time (duración real de conversación, sin hold/queue)
          const talkTime = parseInt(row.talk_time);
          if (!isNaN(talkTime)) {
            data.call_duration = talkTime;
          }
        }
      }

      logger.info(`queue_log: ${result.rows.length}/${uniqueids.length} con hangup_by`);
    } catch (err) {
      logger.warn('Error consultando queue_log para hangup_by', { message: err.message });
    }
  }

  _formatAgent(row) {
    return {
      agent_id: row.agent_id ? String(row.agent_id).trim() : null,
      agent_name: row.agent_name ? row.agent_name.trim() : null,
      agent_extension: row.agent_extension ? String(row.agent_extension).trim() : null,
      call_duration: row.call_duration != null ? parseInt(row.call_duration) : null,
      hangup_by: null,
      proyecto_id: row.proyecto_id != null ? parseInt(row.proyecto_id) : null,
    };
  }
}

module.exports = new AwareDBService();
