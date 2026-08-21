const { Client: PGClient } = require('pg');
const voicebotSource = require('../config/voicebotSource');
const { CRITERIA } = require('../config/evaluationCriteria');
const logger = require('../utils/logger');
const db = require('../database/connection');
const AuditService = require('./AuditService');

const HUMAN_PROYECTO_IDS = Object.keys(voicebotSource.humanProyectos).map(Number);

function proyectosForClientCodes(clientCodes) {
  return HUMAN_PROYECTO_IDS.filter((id) => clientCodes.includes(voicebotSource.humanProyectos[id]));
}

class SofiaHumanService {
  async _connect() {
    const pgClient = new PGClient({ ...voicebotSource.db, statement_timeout: 20000, connectionTimeoutMillis: 10000 });
    pgClient.on('error', (err) => logger.error('SofiaHumanService: error de conexión', err));
    await pgClient.connect();
    return pgClient;
  }

  _mapRow(row) {
    return {
      registro_llamada_id: row.registro_llamada_id,
      proyecto_id: row.proyecto_id,
      client_code: voicebotSource.humanProyectos[row.proyecto_id] || null,
      fecha: row.registro_llamada_fecha instanceof Date
        ? row.registro_llamada_fecha.toISOString().slice(0, 10)
        : String(row.registro_llamada_fecha).slice(0, 10),
      hora: row.registro_llamada_hora,
      telefono: row.registro_llamada_fono,
      agente_id: row.agente_id,
      duracion: row.time_speaking,
      audiofile: row.audiofile,
    };
  }

  /**
   * Llamadas de las colas humanas donde aterrizan las transferencias de SOFIA,
   * para un día puntual, acotadas a los client_codes permitidos del usuario.
   * A cada llamada se le adjunta si el AGENTE ya tiene una selección esta
   * semana (no la llamada puntual) — mismo criterio que audit_selections:
   * un agente se audita una vez por semana, sin importar cuál llamada.
   */
  async listCallsForDay({ clientCodes, date }) {
    const proyectoIds = proyectosForClientCodes(clientCodes);
    if (!proyectoIds.length) return [];

    const targetDate = date || new Date().toISOString().slice(0, 10);

    const pgClient = await this._connect();
    let calls;
    try {
      const result = await pgClient.query(
        `SELECT registro_llamada_id, proyecto_id, registro_llamada_fecha, registro_llamada_hora,
                registro_llamada_fono, agente_id, time_speaking, audiofile
         FROM registro_llamada
         WHERE proyecto_id = ANY($1::int[]) AND registro_llamada_fecha = $2 AND time_speaking > 0
         ORDER BY registro_llamada_hora DESC
         LIMIT 500`,
        [proyectoIds, targetDate]
      );
      calls = result.rows.map((r) => this._mapRow(r));
    } finally {
      await pgClient.end().catch(() => {});
    }

    return this._attachSelections(calls, targetDate);
  }

  /**
   * Adjunta selection_id/selection_status por AGENTE (no por llamada): si el
   * agente de una fila ya tiene una selección la semana de `date`, esa fila
   * sale marcada con esa selección, sin importar si es de otra llamada.
   */
  async _attachSelections(calls, date) {
    if (!calls.length) return calls;
    const { monday } = AuditService._getWeekBounds(date);
    const agentIds = [...new Set(calls.map((c) => c.agente_id))];

    const selections = await db('sofia_human_selections')
      .whereIn('agente_id', agentIds)
      .where('week_start', monday)
      .select('id', 'agente_id', 'status');
    const byAgent = new Map(selections.map((s) => [s.agente_id, s]));

    return calls.map((c) => {
      const sel = byAgent.get(c.agente_id);
      return {
        ...c,
        selection_id: sel ? sel.id : null,
        selection_status: sel ? sel.status : null,
      };
    });
  }

  /**
   * Selecciona una llamada para auditar (equivalente a audit.controller.selectOne).
   * Si el agente ya tiene una selección esta semana, devuelve ESA selección
   * en vez de crear una nueva (mismo comportamiento que hoy tiene el sistema
   * estándar vía UNIQUE(agent_id, week_start)).
   */
  async selectOne({ registroLlamadaId, proyectoId, userId }) {
    const clientCode = voicebotSource.humanProyectos[proyectoId];
    if (!clientCode) {
      const err = new Error('proyecto_id inválido');
      err.statusCode = 400;
      throw err;
    }

    const pgClient = await this._connect();
    let row;
    try {
      const result = await pgClient.query(
        `SELECT registro_llamada_id, proyecto_id, registro_llamada_fecha, registro_llamada_hora,
                registro_llamada_fono, agente_id, time_speaking, audiofile
         FROM registro_llamada
         WHERE registro_llamada_id = $1 AND proyecto_id = $2
         LIMIT 1`,
        [registroLlamadaId, proyectoId]
      );
      row = result.rows[0];
    } finally {
      await pgClient.end().catch(() => {});
    }

    if (!row) {
      const err = new Error('Llamada no encontrada');
      err.statusCode = 404;
      throw err;
    }

    const call = this._mapRow(row);
    const { monday, sunday } = AuditService._getWeekBounds(call.fecha);

    try {
      const [id] = await db('sofia_human_selections').insert({
        registro_llamada_id: call.registro_llamada_id,
        proyecto_id: call.proyecto_id,
        client_code: clientCode,
        agente_id: call.agente_id,
        telefono: call.telefono,
        fecha: call.fecha,
        hora: call.hora,
        duracion: call.duracion,
        audiofile: call.audiofile,
        auditor_id: userId,
        week_start: monday,
        week_end: sunday,
        status: 'selected',
      });
      return { id };
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
        const existing = await db('sofia_human_selections')
          .where({ agente_id: call.agente_id, week_start: monday })
          .first();
        return { id: existing.id };
      }
      throw err;
    }
  }

  async getSelectionById(id) {
    return db('sofia_human_selections').where({ id }).first();
  }

  async updateStatus(id, { status, notes }) {
    const update = { updated_at: db.fn.now() };
    if (status !== undefined) update.status = status;
    if (notes !== undefined) update.notes = notes;
    const affected = await db('sofia_human_selections').where({ id }).update(update);
    return affected > 0;
  }

  getAudioUrl(audiofile) {
    return `${voicebotSource.audioBaseUrl}/${audiofile}`;
  }

  /**
   * Plantilla en blanco de la matriz de calidad estándar para ese client_code
   * (misma CRITERIA que usan hoy los auditores de Claro Hogar/TyT en
   * "Auditorías" — cero duplicación de pesos/labels).
   */
  getCriteriaTemplate(clientCode) {
    const template = CRITERIA[clientCode];
    if (!template) return null;
    return {
      label: template.label,
      general: template.general.map((item) => ({ ...item, cumple: true, na: false, observacion: '' })),
      highImpact: template.highImpact.map((item) => ({ ...item, cumple: true, observacion: '' })),
    };
  }

  /** Idéntico a AuditService/AnalysisService._calcScore. */
  _calcScore(criteria) {
    const highImpact = criteria.highImpact || [];
    const general = criteria.general || [];
    const hasFail = highImpact.some((i) => !i.cumple);
    if (hasFail) return { score: 0, highImpactFailed: true };
    let applicable = 0;
    let earned = 0;
    for (const item of general) {
      if (item.na) continue;
      applicable += item.weight;
      if (item.cumple) earned += item.weight;
    }
    return {
      score: applicable > 0 ? Math.round((earned / applicable) * 100) : 0,
      highImpactFailed: false,
    };
  }

  async saveScore(id, { criteria, notes }) {
    const { score, highImpactFailed } = this._calcScore(criteria);

    await db('sofia_human_selections')
      .where({ id })
      .update({
        criteria_general: JSON.stringify(criteria.general),
        criteria_high_impact: JSON.stringify(criteria.highImpact),
        high_impact_failed: highImpactFailed,
        score,
        notes: notes ?? null,
        status: 'completed',
        scored_at: db.fn.now(),
        updated_at: db.fn.now(),
      });

    return { score, highImpactFailed };
  }
}

module.exports = new SofiaHumanService();
