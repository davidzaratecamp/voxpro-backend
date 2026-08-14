const { Client: PGClient } = require('pg');
const voicebotSource = require('../config/voicebotSource');
const logger = require('../utils/logger');

const PROYECTO_IDS = Object.keys(voicebotSource.proyectos).map(Number);

class VoicebotService {
  async _connect() {
    const pgClient = new PGClient({ ...voicebotSource.db, statement_timeout: 20000, connectionTimeoutMillis: 10000 });
    pgClient.on('error', (err) => logger.error('VoicebotService: error de conexión', err));
    await pgClient.connect();
    return pgClient;
  }

  _mapRow(row) {
    const analysis = row.call_analysis || {};
    return {
      call_id: row.call_id,
      proyecto_id: row.proyecto_id,
      proyecto_name: voicebotSource.proyectos[row.proyecto_id] || String(row.proyecto_id),
      fecha: row.fecha instanceof Date ? row.fecha.toISOString().slice(0, 10) : String(row.fecha).slice(0, 10),
      hora: row.hora,
      telefono: row.telefono,
      duracion: row.duracion,
      hangup_reason: row.hangup_reason,
      call_summary: analysis.call_summary || null,
      user_sentiment: analysis.user_sentiment || null,
      call_successful: analysis.call_successful ?? null,
      tipo_servicio: analysis.custom_analysis_data?.TIPO_SERVICIO || null,
    };
  }

  /**
   * Lista llamadas del voicebot con filtros. Acotado a los proyectos configurados
   * (12 y 13) y a un rango de fechas (default: últimos 7 días) para no traer
   * de más — la vista ya tiene más de 17k filas y sigue creciendo.
   */
  async listCalls({ date_from, date_to, proyecto_id, only_transfer, phone } = {}) {
    const pgClient = await this._connect();
    try {
      const to = date_to || new Date().toISOString().slice(0, 10);
      const from = date_from || (() => {
        const d = new Date(to);
        d.setDate(d.getDate() - 7);
        return d.toISOString().slice(0, 10);
      })();

      const conditions = ['proyecto_id = ANY($1::int[])', 'fecha BETWEEN $2 AND $3'];
      const params = [proyecto_id ? [Number(proyecto_id)] : PROYECTO_IDS, from, to];

      if (only_transfer === 'true' || only_transfer === true) {
        conditions.push(`hangup_reason = 'call_transfer'`);
      }
      if (phone) {
        params.push(`%${phone}%`);
        conditions.push(`telefono ILIKE $${params.length}`);
      }

      const result = await pgClient.query(
        `SELECT proyecto_id, call_id, fecha, hora, hangup_reason, duracion, telefono, call_analysis
         FROM v_voicebot_result
         WHERE ${conditions.join(' AND ')}
         ORDER BY fecha DESC, hora DESC
         LIMIT 500`,
        params
      );

      return result.rows.map((r) => this._mapRow(r));
    } finally {
      await pgClient.end().catch(() => {});
    }
  }

  /**
   * Detalle completo de una llamada, incluida la transcripción.
   */
  async getCallById(callId) {
    const pgClient = await this._connect();
    try {
      const result = await pgClient.query(
        `SELECT proyecto_id, call_id, fecha, hora, hangup_reason, duracion, audiofile, telefono, call_analysis, transcript_object
         FROM v_voicebot_result
         WHERE call_id = $1 AND proyecto_id = ANY($2::int[])
         LIMIT 1`,
        [callId, PROYECTO_IDS]
      );
      const row = result.rows[0];
      if (!row) return null;

      return {
        ...this._mapRow(row),
        audiofile: row.audiofile,
        transcript: Array.isArray(row.transcript_object) ? row.transcript_object : [],
      };
    } finally {
      await pgClient.end().catch(() => {});
    }
  }

  /**
   * Solo lo necesario para armar la URL de audio (streamAudio en el controlador).
   */
  async getAudioFile(callId) {
    const pgClient = await this._connect();
    try {
      const result = await pgClient.query(
        `SELECT audiofile FROM v_voicebot_result WHERE call_id = $1 AND proyecto_id = ANY($2::int[]) LIMIT 1`,
        [callId, PROYECTO_IDS]
      );
      return result.rows[0]?.audiofile || null;
    } finally {
      await pgClient.end().catch(() => {});
    }
  }
}

module.exports = new VoicebotService();
