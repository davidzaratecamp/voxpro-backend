const { Client: PGClient } = require('pg');
const voicebotSource = require('../config/voicebotSource');
const logger = require('../utils/logger');
const db = require('../database/connection');

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

  /**
   * Llamadas de un proyecto con fecha+hora >= sinceTimestamp, ordenadas de más
   * antigua a más nueva. Usado por el cron de auditoría automática.
   */
  async listCallsSince(proyectoId, sinceTimestamp, limit = 20) {
    const pgClient = await this._connect();
    try {
      const result = await pgClient.query(
        `SELECT proyecto_id, call_id, fecha, hora, hangup_reason, duracion, telefono, call_analysis
         FROM v_voicebot_result
         WHERE proyecto_id = $1 AND (fecha + hora) >= $2::timestamp
         ORDER BY fecha ASC, hora ASC
         LIMIT $3`,
        [proyectoId, sinceTimestamp, limit]
      );
      return result.rows.map((r) => this._mapRow(r));
    } finally {
      await pgClient.end().catch(() => {});
    }
  }

  // ── Prompts (matriz de calidad IA), configuración local en MySQL ──────────

  async getPrompts() {
    const rows = await db('voicebot_prompts').select('proyecto_id', 'prompt_text', 'updated_at');
    const map = {};
    for (const r of rows) map[r.proyecto_id] = { prompt_text: r.prompt_text, updated_at: r.updated_at };
    return map;
  }

  async getPrompt(proyectoId) {
    const row = await db('voicebot_prompts').where('proyecto_id', proyectoId).first();
    return row?.prompt_text || null;
  }

  async savePrompt(proyectoId, promptText, userId) {
    const existing = await db('voicebot_prompts').where('proyecto_id', proyectoId).first();
    if (existing) {
      await db('voicebot_prompts').where('proyecto_id', proyectoId)
        .update({ prompt_text: promptText, updated_by: userId, updated_at: db.fn.now() });
    } else {
      await db('voicebot_prompts').insert({ proyecto_id: proyectoId, prompt_text: promptText, updated_by: userId });
    }
  }

  // ── Estado del switch de auditoría automática ──────────────────────────────

  async getAuditSettings() {
    const row = await db('voicebot_audit_settings').where('id', 1).first();
    return { enabled: !!row?.enabled, enabled_at: row?.enabled_at || null };
  }

  async setAuditEnabled(enabled, userId) {
    const updates = { enabled };
    if (enabled) {
      updates.enabled_at = db.fn.now();
      updates.enabled_by = userId;
    }
    await db('voicebot_audit_settings').where('id', 1).update(updates);
    return this.getAuditSettings();
  }

  // ── Resultados de auditoría IA por llamada ─────────────────────────────────

  async getCallAudit(callId) {
    const row = await db('voicebot_call_audits').where('call_id', callId).first();
    return row || null;
  }
}

module.exports = new VoicebotService();
