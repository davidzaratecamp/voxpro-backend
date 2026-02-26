const db = require('../database/connection');
const { LV_PROYECTO_IDS, LV_CUSTOMER_PROYECTO, OBAMA_CUSTOMER_AGENTS } = require('../config/evaluationCriteria');

// Duración mínima en segundos para seleccionar llamadas LV
const LV_MIN_DURATION = 60;

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
   * Distribuye proporcionalmente por cliente según su cantidad de agentes.
   * Se ejecuta cada mañana (lun-sáb).
   *
   * Algoritmo:
   * 1. Determinar fecha objetivo (default: ayer) y semana
   * 2. Contar agentes totales por cliente (de toda la semana)
   * 3. Calcular cuota diaria por cliente = (agentes_cliente / agentes_total) / días_restantes
   * 4. Obtener grabaciones del día, excluyendo agentes ya seleccionados
   * 5. Por cada cliente, elegir hasta su cuota diaria de agentes con grabación "media"
   * 6. Insertar en audit_selections
   *
   * @param {string|null} targetDate - Fecha a auditar (YYYY-MM-DD). Default: ayer.
   * @returns {object} Resumen de la selección
   */
  async selectForDay(targetDate = null) {
    const date = targetDate || this._previousWorkDay();
    const { monday, sunday } = this._getWeekBounds(date);

    // Días laborales restantes en la semana (lun=1 a sáb=6)
    const targetDay = new Date(date).getUTCDay(); // 0=dom...6=sáb
    const workDayIndex = targetDay === 0 ? 6 : targetDay; // lun=1..sáb=6
    const remainingDays = 7 - workDayIndex; // incluyendo hoy

    // Agentes totales por cliente (toda la semana, para calcular proporciones)
    // Se hace en JS para poder reclasificar LV (proyecto_id 34,35) desde obama
    const weekAgents = await db('recordings as r')
      .join('aware_sources as s', 'r.aware_source_id', 's.id')
      .join('clients as c', 's.client_id', 'c.id')
      .whereNotNull('r.agent_id')
      .where('r.agent_id', '!=', '-1')
      .where('r.file_date', '>=', monday)
      .where('r.file_date', '<=', sunday)
      .select('c.code as client_code', 'r.agent_id', 'r.proyecto_id');

    // Reclasificar LV y contar agentes únicos por cliente
    const agentsByClient = new Map(); // client_code → Set(agent_id)
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

    // Agentes ya seleccionados esta semana, por cliente
    const alreadySelected = await db('audit_selections as a')
      .leftJoin('recordings as sel_r', 'a.recording_id', 'sel_r.id')
      .where('a.week_start', monday)
      .select('a.agent_id', 'a.client_code', 'a.recording_id', 'sel_r.proyecto_id');
    const selectedSet = new Set(alreadySelected.map((r) => r.agent_id));
    const selectedByClient = new Map();
    for (const row of alreadySelected) {
      selectedByClient.set(row.client_code, (selectedByClient.get(row.client_code) || 0) + 1);
    }

    // Para LV: recording_ids ya seleccionados (evitar duplicados)
    const lvSelectedToday = new Set();
    for (const row of alreadySelected) {
      if (row.client_code === 'lv') {
        lvSelectedToday.add(String(row.recording_id));
      }
    }

    // Calcular cuota diaria por cliente
    // cuota = (agentes_cliente - ya_seleccionados_cliente) / días_restantes, redondeado arriba
    // LV no tiene cuota — se auditan todos los agentes todos los días
    const quotas = new Map();
    for (const row of agentCounts) {
      if (row.client_code === 'lv') {
        quotas.set('lv', Infinity);
        continue;
      }
      const alreadyDone = selectedByClient.get(row.client_code) || 0;
      const pending = row.total_agents - alreadyDone;
      const daily = Math.ceil(pending / remainingDays);
      quotas.set(row.client_code, daily);
    }

    // Grabaciones del día objetivo con agente válido y tamaño mínimo
    // (archivos < 10 KB son grabaciones corruptas/vacías)
    const recordings = await db('recordings as r')
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

    // Separar grabaciones LV vs otros clientes
    // LV: seleccionar TODAS las grabaciones >= LV_MIN_DURATION (60s)
    // Otros: agrupar por agente, 1 por agente por semana
    const lvRecordings = []; // LV: todas las que cumplan duración
    const byClientAgent = new Map(); // otros: client_code → Map(agent_id → [recs])

    for (const rec of recordings) {
      if (rec.client_code === 'obama' && rec.proyecto_id && LV_PROYECTO_IDS.has(rec.proyecto_id)) {
        rec.client_code = 'lv';
      }

      if (rec.client_code === 'lv') {
        // LV: incluir todas las que tengan duración >= 60s y no estén ya seleccionadas hoy
        if (lvSelectedToday.has(String(rec.id))) continue;
        if (rec.call_duration != null && rec.call_duration >= LV_MIN_DURATION) {
          lvRecordings.push(rec);
        }
      } else {
        // Otros clientes: saltar si el agente ya fue seleccionado esta semana
        if (selectedSet.has(rec.agent_id)) continue;
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

    // Otros clientes: 1 grabación por agente por semana
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
      already_selected: selectedSet.size,
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
    const day = d.getUTCDay(); // 0=dom, 1=lun...
    if (day === 1) {
      // Lunes: auditar el sábado
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

    // Filtrar por duración mínima
    const valid = recs.filter(
      (r) => r.call_duration != null && r.call_duration >= LV_MIN_DURATION
    );
    if (valid.length) {
      return valid[Math.floor(Math.random() * valid.length)];
    }

    // Fallback: si no hay duración, elegir aleatoria de las que tengan tamaño razonable
    const bySize = recs.filter((r) => r.file_size != null && r.file_size >= 10240);
    if (bySize.length) {
      return bySize[Math.floor(Math.random() * bySize.length)];
    }

    return recs[Math.floor(Math.random() * recs.length)];
  }

  /**
   * Lista selecciones de una semana con datos de la grabación.
   * @param {string|null} weekStart - Lunes (YYYY-MM-DD). Default: semana pasada.
   * @param {{ client?: string, status?: string }} filters
   */
  async getWeekSelections(weekStart = null, { client, status, clientCodes, date } = {}) {
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
    if (client) query.where('a.client_code', client);
    if (status) query.where('a.status', status);
    if (date) query.where('r.file_date', date);

    const rows = await query;

    // Agregar campaign_type (ventas/customer) para Obama y LV
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
   * @param {{ client?: string, clientCodes?: string[] }} filters
   */
  async agentsPerformance({ client, clientCodes } = {}) {
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
    if (client) query.where('client_code', client);

    return query;
  }

  /**
   * Lista todas las auditorías de un agente específico.
   * @param {string} agentId
   * @param {string} clientCode
   * @param {{ clientCodes?: string[] }} opts - para validar acceso
   */
  async getAgentAudits(agentId, clientCode, { clientCodes } = {}) {
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

    const rows = await query;

    for (const row of rows) {
      row.campaign_type = this._getCampaignType(row.client_code, row.agent_id, row.proyecto_id);
    }

    return rows;
  }

  /**
   * Resumen general: semanas procesadas, pendientes, completadas.
   */
  async summary(clientCodes = null) {
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

    const [totals] = await totalsQuery;

    return { totals, weeks };
  }
}

module.exports = new AuditService();
