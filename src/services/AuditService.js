const db = require('../database/connection');
const { LV_PROYECTO_IDS, LV_CUSTOMER_PROYECTO, OBAMA_CUSTOMER_AGENTS } = require('../config/evaluationCriteria');

// Duración mínima en segundos para seleccionar llamadas
const LV_MIN_DURATION = 60;

// Máximo de selecciones por agente por semana (por auditor)
const MAX_PER_AGENT = 2;

class AuditService {
  /**
   * Calcula lunes y domingo de la semana que contiene una fecha dada.
   * Usa UTC internamente para evitar problemas de timezone.
   * @param {string|null} date - Cualquier fecha (YYYY-MM-DD). Default: ayer.
   * @returns {{ monday: string, sunday: string }}
   */
  _getWeekBounds(date) {
    let ref;
    if (date) {
      const [y, m, d] = date.split('-').map(Number);
      ref = new Date(Date.UTC(y, m - 1, d));
    } else {
      const now = new Date();
      ref = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    }

    const day = ref.getUTCDay(); // 0=dom, 1=lun...
    const diffToMonday = day === 0 ? 6 : day - 1;

    const monday = new Date(ref);
    monday.setUTCDate(ref.getUTCDate() - diffToMonday);

    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);

    const fmt = (d) => d.toISOString().slice(0, 10);
    return { monday: fmt(monday), sunday: fmt(sunday) };
  }

  /**
   * Selecciona llamadas del día anterior para auditoría diaria.
   * Cada auditor tiene su propia cuota independiente (MAX_PER_AGENT por agente/semana).
   * El UNIQUE(recording_id) en la DB evita que dos auditores seleccionen la misma grabación.
   *
   * @param {string|null} targetDate - Fecha a auditar (YYYY-MM-DD). Default: ayer.
   * @param {number} userId - ID del auditor que ejecuta el scan.
   * @returns {object} Resumen de la selección
   */
  async selectForDay(targetDate = null, userId) {
    const date = targetDate || this._previousWorkDay();
    const { monday, sunday } = this._getWeekBounds(date);

    // Días laborales restantes en la semana (lun=1 a sáb=6)
    const targetDay = new Date(date).getUTCDay();
    const workDayIndex = targetDay === 0 ? 6 : targetDay;
    const remainingDays = 7 - workDayIndex;

    // Filtro de agentes asignados a este coordinador por cédula (null = sin restricción)
    const userRow = await db('users').where('id', userId).select('agent_ids').first();
    const agentIds = userRow?.agent_ids
      ? (typeof userRow.agent_ids === 'string' ? JSON.parse(userRow.agent_ids) : userRow.agent_ids)
      : null;

    // Agentes totales por cliente (toda la semana, para calcular proporciones)
    const weekAgentsQuery = db('recordings as r')
      .join('aware_sources as s', 'r.aware_source_id', 's.id')
      .join('clients as c', 's.client_id', 'c.id')
      .whereNotNull('r.agent_id')
      .where('r.agent_id', '!=', '-1')
      .where('r.file_date', '>=', monday)
      .where('r.file_date', '<=', sunday)
      .select('c.code as client_code', 'r.agent_id', 'r.proyecto_id');

    if (agentIds) weekAgentsQuery.whereIn('r.agent_id', agentIds);

    const weekAgents = await weekAgentsQuery;

    // Reclasificar LV y contar agentes únicos por cliente
    const agentsByClient = new Map();
    for (const row of weekAgents) {
      let code = row.client_code;
      if (code === 'obama' && row.proyecto_id && LV_PROYECTO_IDS.has(row.proyecto_id)) {
        code = 'lv';
      }
      if (!agentsByClient.has(code)) agentsByClient.set(code, new Set());
      agentsByClient.get(code).add(row.agent_id);
    }
    const agentCounts = [...agentsByClient.entries()].map(([client_code, agents]) => ({
      client_code,
      total_agents: agents.size,
    }));

    const totalAgents = agentCounts.reduce((sum, r) => sum + r.total_agents, 0);

    // Selecciones ya hechas ESTA SEMANA por ESTE auditor
    const alreadySelected = await db('audit_selections as a')
      .leftJoin('recordings as sel_r', 'a.recording_id', 'sel_r.id')
      .where('a.week_start', monday)
      .where('a.auditor_id', userId)
      .select('a.agent_id', 'a.client_code', 'a.recording_id', 'sel_r.proyecto_id');

    // Contar selecciones por (agent_id, client_code) para respetar MAX_PER_AGENT
    const selectedCountByAgent = new Map(); // key: `${agent_id}::${client_code}` → count
    const selectedRecordingIds = new Set(); // grabaciones ya seleccionadas por este auditor
    const selectedByClient = new Map();    // client_code → total count

    for (const row of alreadySelected) {
      const key = `${row.agent_id}::${row.client_code}`;
      selectedCountByAgent.set(key, (selectedCountByAgent.get(key) || 0) + 1);
      selectedByClient.set(row.client_code, (selectedByClient.get(row.client_code) || 0) + 1);
      if (row.recording_id) selectedRecordingIds.add(String(row.recording_id));
    }

    // Para LV: recording_ids ya seleccionados hoy por este auditor
    const lvSelectedToday = new Set();
    for (const row of alreadySelected) {
      if (row.client_code === 'lv' && row.recording_id) {
        lvSelectedToday.add(String(row.recording_id));
      }
    }

    // Calcular cuota diaria por cliente
    // Si el coordinador tiene agentes asignados (agentIds), se traen TODOS de una vez.
    // LV tampoco tiene cuota — se auditan todos los elegibles.
    // Para otros clientes: cuota = ceil((MAX_PER_AGENT * agentes - ya_seleccionados) / días_restantes)
    const quotas = new Map();
    for (const row of agentCounts) {
      if (row.client_code === 'lv' || agentIds) {
        quotas.set(row.client_code, Infinity);
        continue;
      }
      const alreadyDone = selectedByClient.get(row.client_code) || 0;
      const pending = Math.max(0, MAX_PER_AGENT * row.total_agents - alreadyDone);
      const daily = Math.ceil(pending / remainingDays);
      quotas.set(row.client_code, daily);
    }

    // Grabaciones del día objetivo con agente válido y tamaño mínimo
    const recordingsQuery = db('recordings as r')
      .join('aware_sources as s', 'r.aware_source_id', 's.id')
      .join('clients as c', 's.client_id', 'c.id')
      .whereNotNull('r.agent_id')
      .where('r.agent_id', '!=', '-1')
      .where('r.file_date', date)
      .where('r.file_size', '>=', 10240)
      .select(
        'r.id',
        'r.agent_id',
        'r.agent_name',
        'r.call_duration',
        'r.file_size',
        'r.proyecto_id',
        'c.code as client_code'
      );

    if (agentIds) recordingsQuery.whereIn('r.agent_id', agentIds);

    const recordings = await recordingsQuery;

    // Separar grabaciones LV vs otros clientes
    const lvRecordings = [];
    const byClientAgent = new Map(); // client_code → Map(agent_id → [recs])

    for (const rec of recordings) {
      if (rec.client_code === 'obama' && rec.proyecto_id && LV_PROYECTO_IDS.has(rec.proyecto_id)) {
        rec.client_code = 'lv';
      }

      if (rec.client_code === 'lv') {
        if (lvSelectedToday.has(String(rec.id))) continue;
        if (rec.call_duration != null && rec.call_duration >= LV_MIN_DURATION) {
          lvRecordings.push(rec);
        }
      } else {
        // Coordinadores con agentes asignados: sin límite semanal por agente
        if (!agentIds) {
          const agentKey = `${rec.agent_id}::${rec.client_code}`;
          if ((selectedCountByAgent.get(agentKey) || 0) >= MAX_PER_AGENT) continue;
        }
        // Saltar si esta grabación ya fue seleccionada por este auditor
        if (selectedRecordingIds.has(String(rec.id))) continue;

        if (!byClientAgent.has(rec.client_code)) {
          byClientAgent.set(rec.client_code, new Map());
        }
        const agentMap = byClientAgent.get(rec.client_code);
        if (!agentMap.has(rec.agent_id)) {
          agentMap.set(rec.agent_id, []);
        }
        agentMap.get(rec.agent_id).push(rec);
      }
    }

    let inserted = 0;
    let skipped = 0;
    const breakdown = {};

    // LV: insertar TODAS las grabaciones que cumplen el filtro
    if (lvRecordings.length > 0) {
      let lvInserted = 0;
      for (const rec of lvRecordings) {
        try {
          await db('audit_selections').insert({
            recording_id: rec.id,
            agent_id: rec.agent_id,
            agent_name: rec.agent_name,
            client_code: 'lv',
            auditor_id: userId,
            week_start: monday,
            week_end: sunday,
            status: 'selected',
          });
          inserted++;
          lvInserted++;
        } catch (err) {
          if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
            skipped++;
          } else {
            throw err;
          }
        }
      }
      breakdown.lv = { quota: 'all', selected: lvInserted, available: lvRecordings.length };
    }

    // Otros clientes: hasta MAX_PER_AGENT grabaciones por agente por semana
    for (const [clientCode, agentMap] of byClientAgent) {
      const quota = quotas.get(clientCode) || 1;
      let clientInserted = 0;

      for (const [agentId, recs] of agentMap) {
        if (clientInserted >= quota) break;

        const chosen = this._pickOne(recs);
        if (!chosen) continue;

        try {
          await db('audit_selections').insert({
            recording_id: chosen.id,
            agent_id: agentId,
            agent_name: chosen.agent_name,
            client_code: chosen.client_code,
            auditor_id: userId,
            week_start: monday,
            week_end: sunday,
            status: 'selected',
          });
          inserted++;
          clientInserted++;
        } catch (err) {
          if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
            skipped++;
          } else {
            throw err;
          }
        }
      }

      breakdown[clientCode] = { quota, selected: clientInserted, available: agentMap.size };
    }

    return {
      inserted,
      skipped,
      already_selected: alreadySelected.length,
      total_agents: totalAgents,
      remaining_days: remainingDays,
      date,
      week: { start: monday, end: sunday },
      breakdown,
    };
  }

  /**
   * Devuelve la fecha del día laboral anterior como YYYY-MM-DD.
   * Lunes → sábado (el domingo no se trabaja).
   * Martes a sábado → día anterior.
   */
  _previousWorkDay() {
    const now = new Date();
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const day = d.getUTCDay();
    if (day === 1) {
      d.setUTCDate(d.getUTCDate() - 2);
    } else {
      d.setUTCDate(d.getUTCDate() - 1);
    }
    return d.toISOString().slice(0, 10);
  }

  /**
   * Determina el tipo de campaña (ventas/customer) para Obama y LV.
   * @returns {string|null} 'ventas', 'customer', o null si no aplica
   */
  _getCampaignType(clientCode, agentId, proyectoId) {
    if (clientCode === 'obama') {
      return agentId && OBAMA_CUSTOMER_AGENTS.has(String(agentId)) ? 'customer' : 'ventas';
    }
    if (clientCode === 'lv') {
      return proyectoId === LV_CUSTOMER_PROYECTO ? 'customer' : 'ventas';
    }
    return null;
  }

  /**
   * Elige una grabación aleatoria del grupo que cumpla duración >= 60s.
   * Fallback por tamaño >= 10KB si no hay datos de duración.
   */
  _pickOne(recs) {
    if (!recs.length) return null;

    const valid = recs.filter(
      (r) => r.call_duration != null && r.call_duration >= LV_MIN_DURATION
    );
    if (valid.length) {
      return valid[Math.floor(Math.random() * valid.length)];
    }

    const bySize = recs.filter((r) => r.file_size != null && r.file_size >= 10240);
    if (bySize.length) {
      return bySize[Math.floor(Math.random() * bySize.length)];
    }

    return recs[Math.floor(Math.random() * recs.length)];
  }

  /**
   * Lista selecciones de una semana con datos de la grabación.
   * Filtra por auditor_id para que cada auditor solo vea sus propias selecciones.
   *
   * @param {string|null} weekStart - Lunes (YYYY-MM-DD). Default: semana actual.
   * @param {{ client?: string, status?: string, clientCodes?: string[], date?: string, userId?: number }} filters
   */
  async getWeekSelections(weekStart = null, { client, status, clientCodes, date, userId } = {}) {
    const { monday } = this._getWeekBounds(weekStart);

    const query = db('audit_selections as a')
      .join('recordings as r', 'a.recording_id', 'r.id')
      .where('a.week_start', monday)
      .select(
        'a.id',
        'a.recording_id',
        'a.agent_id',
        'a.agent_name',
        'a.client_code',
        'a.auditor_id',
        'a.week_start',
        'a.week_end',
        'a.status',
        'a.score',
        'a.notes',
        'a.created_at',
        'r.file_name',
        'r.file_path',
        'r.file_size',
        'r.file_date',
        'r.call_duration',
        'r.call_phone',
        'r.proyecto_id'
      )
      .orderBy('a.agent_name', 'asc');

    if (clientCodes && clientCodes.length) {
      query.whereIn('a.client_code', clientCodes);
    }
    if (userId) query.where('a.auditor_id', userId);
    if (client) query.where('a.client_code', client);
    if (status) query.where('a.status', status);
    if (date) query.where('r.file_date', date);

    const rows = await query;

    for (const row of rows) {
      row.campaign_type = this._getCampaignType(row.client_code, row.agent_id, row.proyecto_id);
    }

    return rows;
  }

  /**
   * Obtiene una selección por ID con datos completos.
   */
  async getById(id) {
    const row = await db('audit_selections as a')
      .join('recordings as r', 'a.recording_id', 'r.id')
      .where('a.id', id)
      .select(
        'a.*',
        'r.file_name',
        'r.file_path',
        'r.file_size',
        'r.file_date',
        'r.call_duration',
        'r.call_phone',
        'r.call_id',
        'r.agent_extension',
        'r.hangup_by',
        'r.proyecto_id'
      )
      .first();

    if (row) {
      row.campaign_type = this._getCampaignType(row.client_code, row.agent_id, row.proyecto_id);
    }

    return row;
  }

  /**
   * Actualiza estado, score y/o notas de una selección.
   */
  async updateSelection(id, { status, score, notes }) {
    const update = { updated_at: db.fn.now() };

    if (status !== undefined) update.status = status;
    if (score !== undefined) update.score = score;
    if (notes !== undefined) update.notes = notes;

    const affected = await db('audit_selections').where({ id }).update(update);
    return affected > 0;
  }

  /**
   * Rendimiento agregado por agente desde audit_selections.
   * Filtra por auditor_id para que cada auditor solo vea su propio rendimiento.
   *
   * @param {{ client?: string, clientCodes?: string[], userId?: number }} filters
   */
  async agentsPerformance({ client, clientCodes, userId } = {}) {
    const query = db('audit_selections')
      .select(
        'agent_id',
        db.raw('MAX(agent_name) as agent_name'),
        'client_code',
        db.raw('COUNT(*) as total_audits'),
        db.raw("SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed"),
        db.raw("SUM(CASE WHEN status = 'in_review' THEN 1 ELSE 0 END) as in_review"),
        db.raw("SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped"),
        db.raw("ROUND(AVG(CASE WHEN status = 'completed' THEN score END), 1) as avg_score"),
        db.raw("MIN(CASE WHEN status = 'completed' THEN score END) as min_score"),
        db.raw("MAX(CASE WHEN status = 'completed' THEN score END) as max_score"),
        db.raw('MAX(week_start) as last_audit_week')
      )
      .groupBy('agent_id', 'client_code')
      .orderBy('avg_score', 'asc');

    if (clientCodes && clientCodes.length) {
      query.whereIn('client_code', clientCodes);
    }
    if (userId) query.where('auditor_id', userId);
    if (client) query.where('client_code', client);

    return query;
  }

  /**
   * Lista todas las auditorías de un agente específico.
   * Filtra por auditor_id para aislar las selecciones de cada auditor.
   *
   * @param {string} agentId
   * @param {string} clientCode
   * @param {{ clientCodes?: string[], userId?: number }} opts
   */
  async getAgentAudits(agentId, clientCode, { clientCodes, userId } = {}) {
    const query = db('audit_selections as a')
      .join('recordings as r', 'a.recording_id', 'r.id')
      .where('a.agent_id', agentId)
      .where('a.client_code', clientCode)
      .select(
        'a.id',
        'a.recording_id',
        'a.agent_id',
        'a.agent_name',
        'a.client_code',
        'a.auditor_id',
        'a.week_start',
        'a.week_end',
        'a.status',
        'a.score',
        'a.notes',
        'a.created_at',
        'r.file_date',
        'r.call_duration',
        'r.file_name',
        'r.proyecto_id'
      )
      .orderBy('a.week_start', 'desc');

    if (clientCodes && clientCodes.length) {
      query.whereIn('a.client_code', clientCodes);
    }
    if (userId) query.where('a.auditor_id', userId);

    const rows = await query;

    for (const row of rows) {
      row.campaign_type = this._getCampaignType(row.client_code, row.agent_id, row.proyecto_id);
    }

    return rows;
  }

  /**
   * Resumen general: semanas procesadas, pendientes, completadas.
   * Filtra por auditor_id para mostrar solo el trabajo de cada auditor.
   */
  async summary(clientCodes = null, userId = null) {
    const weeksQuery = db('audit_selections')
      .select(
        'week_start',
        'week_end',
        db.raw('COUNT(*) as total'),
        db.raw("SUM(CASE WHEN status = 'selected' THEN 1 ELSE 0 END) as selected"),
        db.raw("SUM(CASE WHEN status = 'in_review' THEN 1 ELSE 0 END) as in_review"),
        db.raw("SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed"),
        db.raw("SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped"),
        db.raw('AVG(score) as avg_score')
      )
      .groupBy('week_start', 'week_end')
      .orderBy('week_start', 'desc');

    if (clientCodes && clientCodes.length) {
      weeksQuery.whereIn('client_code', clientCodes);
    }
    if (userId) weeksQuery.where('auditor_id', userId);

    const weeks = await weeksQuery;

    const totalsQuery = db('audit_selections')
      .select(
        db.raw('COUNT(*) as total_selections'),
        db.raw("SUM(CASE WHEN status = 'selected' THEN 1 ELSE 0 END) as pending_review"),
        db.raw("SUM(CASE WHEN status = 'in_review' THEN 1 ELSE 0 END) as in_review"),
        db.raw("SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed"),
        db.raw("SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped"),
        db.raw('AVG(score) as avg_score'),
        db.raw('COUNT(DISTINCT week_start) as total_weeks')
      );

    if (clientCodes && clientCodes.length) {
      totalsQuery.whereIn('client_code', clientCodes);
    }
    if (userId) totalsQuery.where('auditor_id', userId);

    const [totals] = await totalsQuery;

    return { totals, weeks };
  }
}

module.exports = new AuditService();
