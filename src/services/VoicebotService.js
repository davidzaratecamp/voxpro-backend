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
  async listCalls({ date_from, date_to, proyecto_id, only_transfer, phone, missed_transfer } = {}) {
    const pgClient = await this._connect();
    try {
      const to = date_to || new Date().toISOString().slice(0, 10);
      const from = date_from || (() => {
        const d = new Date(to);
        d.setDate(d.getDate() - 7);
        return d.toISOString().slice(0, 10);
      })();

      const conditions = ['proyecto_id = ANY($1::int[])', 'fecha BETWEEN $2 AND $3'];
      const proyectoFilter = proyecto_id
        ? (Array.isArray(proyecto_id) ? proyecto_id.map(Number) : [Number(proyecto_id)])
        : PROYECTO_IDS;
      const params = [proyectoFilter, from, to];

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

      const calls = result.rows.map((r) => this._mapRow(r));
      const withScores = await this._attachScores(calls);

      if (missed_transfer === 'true' || missed_transfer === true) {
        return withScores.filter((c) => c.missed_transfer === true);
      }
      return withScores;
    } finally {
      await pgClient.end().catch(() => {});
    }
  }

  /**
   * Agrega el puntaje de auditoría IA y la señal de "transferencia perdida"
   * (si existen), consultando la tabla local voicebot_call_audits en un solo query.
   */
  async _attachScores(calls) {
    if (!calls.length) return calls;
    const callIds = calls.map((c) => c.call_id);
    const audits = await db('voicebot_call_audits')
      .whereIn('call_id', callIds)
      .select('call_id', 'score', 'missed_transfer', 'missed_transfer_reason');
    const auditMap = new Map(audits.map((a) => [a.call_id, a]));
    return calls.map((c) => {
      const a = auditMap.get(c.call_id);
      return {
        ...c,
        ai_score: a ? a.score : null,
        missed_transfer: a ? !!a.missed_transfer : false,
        missed_transfer_reason: a ? a.missed_transfer_reason : null,
      };
    });
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
   * Lo necesario para armar la URL de audio y validar acceso por campaña
   * (streamAudio en el controlador).
   */
  async getAudioFile(callId) {
    const pgClient = await this._connect();
    try {
      const result = await pgClient.query(
        `SELECT audiofile, proyecto_id FROM v_voicebot_result WHERE call_id = $1 AND proyecto_id = ANY($2::int[]) LIMIT 1`,
        [callId, PROYECTO_IDS]
      );
      const row = result.rows[0];
      return row ? { audiofile: row.audiofile, proyecto_id: row.proyecto_id } : null;
    } finally {
      await pgClient.end().catch(() => {});
    }
  }

  /**
   * Llamadas de un proyecto con fecha+hora >= sinceTimestamp, ordenadas de más
   * antigua a más nueva. Usado por VoicebotAuditRunner, que trata `sinceTimestamp`
   * como un cursor que avanza en cada corrida (no siempre el mismo enabled_at) —
   * así este bloque siempre es "lo siguiente que falta ver", no una ventana fija.
   */
  async listCallsSince(proyectoId, sinceTimestamp, limit = 40) {
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

  // ── Estado del switch de auditoría automática (uno por campaña) ────────────

  _mapAuditSettingsRow(row) {
    return {
      enabled: !!row?.enabled,
      enabled_at: row?.enabled_at || null,
      disabled_reason: row?.disabled_reason || null,
      last_scanned_at: row?.last_scanned_at || null,
    };
  }

  /**
   * Mapa { proyecto_id: {enabled, enabled_at, disabled_reason, last_scanned_at} }
   * — una entrada por campaña, mismo patrón que getPrompts().
   */
  async getAuditSettings() {
    const rows = await db('voicebot_audit_settings').select('proyecto_id', 'enabled', 'enabled_at', 'disabled_reason', 'last_scanned_at');
    const byId = new Map(rows.map((r) => [r.proyecto_id, r]));
    const map = {};
    for (const id of PROYECTO_IDS) {
      map[id] = this._mapAuditSettingsRow(byId.get(id));
    }
    return map;
  }

  async getAuditSettingsFor(proyectoId) {
    const row = await db('voicebot_audit_settings').where('proyecto_id', proyectoId).first();
    return this._mapAuditSettingsRow(row);
  }

  /**
   * Activa/desactiva el switch de auditoría automática de una campaña.
   * Idempotente: si ya está activo y se pide activar de nuevo, no reinicia
   * el corte (enabled_at) — evita que varios clicks seguidos "salten" llamadas
   * que quedaron pendientes entre el primer click y el segundo.
   * Cualquier acción manual (activar o desactivar) limpia disabled_reason,
   * que solo lo escribe el sistema cuando se autodetiene (ver autoDisableAllEnabled).
   * Al activar (de verdad, no en el caso idempotente de arriba) se reinicia
   * last_scanned_at para que el cursor de avance arranque limpio desde
   * enabled_at.
   */
  async setAuditEnabled(proyectoId, enabled, userId) {
    const current = await this.getAuditSettingsFor(proyectoId);

    if (enabled && current.enabled) {
      return current;
    }

    const updates = { enabled, disabled_reason: null };
    if (enabled) {
      updates.enabled_at = db.fn.now();
      updates.enabled_by = userId;
      updates.last_scanned_at = null;
    }
    await db('voicebot_audit_settings').where('proyecto_id', proyectoId).update(updates);
    return this.getAuditSettingsFor(proyectoId);
  }

  /**
   * Avanza el cursor de avance del runner tras revisar un bloque de llamadas
   * — sin importar si terminaron auditadas o ya lo estaban, para que la
   * próxima corrida siempre pida el SIGUIENTE tramo de la fuente en vez de
   * repetir el mismo bloque para siempre.
   */
  async advanceScanCursor(proyectoId, timestamp) {
    await db('voicebot_audit_settings').where('proyecto_id', proyectoId).update({ last_scanned_at: timestamp });
  }

  /**
   * El propio cron se autodetiene (ej. se agotó la cuota de Gemini, que es
   * de toda la cuenta, no por campaña) — apaga TODAS las campañas que
   * estén activas en ese momento, para no dejar una encendida pero
   * atascada en silencio, y deja registrado el motivo para cuando alguien
   * intente reactivar.
   */
  async autoDisableAllEnabled(reason) {
    await db('voicebot_audit_settings').where('enabled', true).update({ enabled: false, disabled_reason: reason });
  }

  // ── Resultados de auditoría IA por llamada ─────────────────────────────────

  async getCallAudit(callId) {
    const row = await db('voicebot_call_audits').where('call_id', callId).first();
    return row || null;
  }

  // ── Estadísticas agregadas para el dashboard de "Análisis gráfico" ────────

  /**
   * Totales de llamadas y desglose por hangup_reason, por proyecto, en los
   * últimos `days` días (fuente: v_voicebot_result en Postgres).
   */
  async _getCallTotals(days, proyectoIds) {
    const pgClient = await this._connect();
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);
      const sinceStr = since.toISOString().slice(0, 10);

      const result = await pgClient.query(
        `SELECT proyecto_id, hangup_reason, COUNT(*) as count
         FROM v_voicebot_result
         WHERE proyecto_id = ANY($1::int[]) AND fecha >= $2
         GROUP BY proyecto_id, hangup_reason`,
        [proyectoIds, sinceStr]
      );
      return result.rows.map((r) => ({
        proyecto_id: r.proyecto_id,
        hangup_reason: r.hangup_reason,
        count: Number(r.count),
      }));
    } finally {
      await pgClient.end().catch(() => {});
    }
  }

  /**
   * Estadísticas de puntaje (promedio, distribución, tendencia diaria) desde
   * voicebot_call_audits en MySQL. Se calcula en JS sobre el set ya acotado
   * a `days` días — nunca son más de unos cientos de filas.
   */
  async getStats({ days = 30, proyectoIds } = {}) {
    const ids = proyectoIds && proyectoIds.length ? proyectoIds : PROYECTO_IDS;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [totalsByReason, audits] = await Promise.all([
      this._getCallTotals(days, ids),
      db('voicebot_call_audits')
        .whereIn('proyecto_id', ids)
        .where('created_at', '>=', since)
        .select('proyecto_id', 'score', 'missed_transfer', db.raw('DATE(created_at) as audit_date')),
    ]);

    const byProyecto = {};
    for (const id of ids) {
      byProyecto[id] = {
        proyecto_id: id,
        proyecto_name: voicebotSource.proyectos[id],
        total_calls: 0,
        transferred: 0,
        audited: 0,
        avg_score: null,
        low: 0,
        mid: 0,
        high: 0,
        missed_transfer: 0,
      };
    }

    for (const row of totalsByReason) {
      const bucket = byProyecto[row.proyecto_id];
      if (!bucket) continue;
      bucket.total_calls += row.count;
      if (row.hangup_reason === 'call_transfer') bucket.transferred += row.count;
    }

    const scoreSums = {};
    const trendMap = new Map(); // `${date}::${proyecto_id}` -> { sum, count }

    for (const a of audits) {
      const bucket = byProyecto[a.proyecto_id];
      if (bucket) {
        bucket.audited += 1;
        scoreSums[a.proyecto_id] = (scoreSums[a.proyecto_id] || 0) + a.score;
        if (a.score < 60) bucket.low += 1;
        else if (a.score < 80) bucket.mid += 1;
        else bucket.high += 1;
        if (a.missed_transfer) bucket.missed_transfer += 1;
      }

      const dateStr = a.audit_date instanceof Date ? a.audit_date.toISOString().slice(0, 10) : String(a.audit_date).slice(0, 10);
      const key = `${dateStr}::${a.proyecto_id}`;
      const entry = trendMap.get(key) || { date: dateStr, proyecto_id: a.proyecto_id, sum: 0, count: 0 };
      entry.sum += a.score;
      entry.count += 1;
      trendMap.set(key, entry);
    }

    for (const id of ids) {
      const bucket = byProyecto[id];
      bucket.avg_score = bucket.audited > 0 ? Math.round(scoreSums[id] / bucket.audited) : null;
    }

    const trend = [...trendMap.values()]
      .map((t) => ({
        date: t.date,
        proyecto_id: t.proyecto_id,
        avg_score: Math.round(t.sum / t.count),
        count: t.count,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      by_proyecto: Object.values(byProyecto),
      trend,
    };
  }
}

module.exports = new VoicebotService();
