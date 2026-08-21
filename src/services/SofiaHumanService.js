const { execFile } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { Client: PGClient } = require('pg');
const voicebotSource = require('../config/voicebotSource');
const { CRITERIA } = require('../config/evaluationCriteria');
const logger = require('../utils/logger');
const db = require('../database/connection');
const AuditService = require('./AuditService');
const GeminiService = require('./GeminiService');
const RealtimeScanService = require('../controllers/RealtimeScanService');
const { downloadBuffer } = RealtimeScanService;

const execFileAsync = promisify(execFile);

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
      // La propia fuente del bot ya trae el nombre en json_data.agente —
      // cobertura prácticamente total, no depende de que el agente ya
      // esté en recordings ni de que Claro lo tenga cargado en Aware.
      agente_nombre_bot: row.agente_nombre_bot ? row.agente_nombre_bot.trim() : null,
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
  async listCallsForDay({ clientCodes, date, telefono }) {
    const proyectoIds = proyectosForClientCodes(clientCodes);
    if (!proyectoIds.length) return [];

    const targetDate = date || new Date().toISOString().slice(0, 10);

    const conditions = ['proyecto_id = ANY($1::int[])', 'registro_llamada_fecha = $2', 'time_speaking > 0'];
    const params = [proyectoIds, targetDate];
    if (telefono) {
      params.push(`%${telefono}%`);
      conditions.push(`registro_llamada_fono ILIKE $${params.length}`);
    }

    const pgClient = await this._connect();
    let calls;
    try {
      const result = await pgClient.query(
        `SELECT registro_llamada_id, proyecto_id, registro_llamada_fecha, registro_llamada_hora,
                registro_llamada_fono, agente_id, time_speaking, audiofile,
                json_data->>'agente' AS agente_nombre_bot
         FROM registro_llamada
         WHERE ${conditions.join(' AND ')}
         ORDER BY registro_llamada_hora DESC
         LIMIT 500`,
        params
      );
      calls = result.rows.map((r) => this._mapRow(r));
    } finally {
      await pgClient.end().catch(() => {});
    }

    calls = await this._attachAgentNames(calls);
    return this._attachSelections(calls, targetDate);
  }

  /**
   * Resuelve el nombre del agente, de más a menos confiable:
   *  1. `json_data.agente` de la propia fuente del bot — ya viene en la
   *     misma consulta, cobertura prácticamente total (confirmado: 4286/4286
   *     llamadas de los últimos 5 días lo traen), incluso para agentes que
   *     Claro aún no ha dado de alta en su Aware.
   *  2. `recordings` local — cubre agentes que ya tuvieron alguna llamada
   *     orgánica escaneada, por si algún registro puntual no trae (1).
   *  3. `empleado` en vivo en el Aware estándar del cliente (misma fuente
   *     que usa "Auditorías") — último recurso.
   */
  async _attachAgentNames(calls) {
    if (!calls.length) return calls;
    const agentIds = [...new Set(calls.map((c) => c.agente_id))];

    const nameMap = new Map();
    for (const c of calls) {
      if (c.agente_nombre_bot && !nameMap.has(c.agente_id)) nameMap.set(c.agente_id, c.agente_nombre_bot);
    }

    const missingAfterBot = agentIds.filter((id) => !nameMap.has(id));
    if (missingAfterBot.length) {
      const rows = await db('recordings')
        .whereIn('agent_id', missingAfterBot)
        .whereNotNull('agent_name')
        .select('agent_id', 'agent_name')
        .count('* as cnt')
        .groupBy('agent_id', 'agent_name')
        .orderBy('cnt', 'desc');
      for (const row of rows) {
        if (!nameMap.has(row.agent_id)) nameMap.set(row.agent_id, row.agent_name);
      }
    }

    const stillMissing = agentIds.filter((id) => !nameMap.has(id));
    if (stillMissing.length) {
      const byClientCode = new Map();
      for (const c of calls) {
        if (!stillMissing.includes(c.agente_id)) continue;
        if (!byClientCode.has(c.client_code)) byClientCode.set(c.client_code, new Set());
        byClientCode.get(c.client_code).add(c.agente_id);
      }
      await Promise.all(
        [...byClientCode.entries()].map(async ([clientCode, idsSet]) => {
          try {
            const liveMap = await RealtimeScanService.getEmployeeNames([...idsSet], clientCode);
            for (const [id, name] of liveMap) nameMap.set(id, name);
          } catch (err) {
            logger.warn(`SofiaHumanService: no se pudo resolver nombres en vivo para ${clientCode}`, { message: err.message });
          }
        }),
      );
    }

    return calls.map((c) => ({ ...c, agente_nombre: nameMap.get(c.agente_id) || null }));
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
                registro_llamada_fono, agente_id, time_speaking, audiofile,
                json_data->>'agente' AS agente_nombre_bot
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

    const agenteNombre = await this._resolveSingleAgentName(call.agente_id, clientCode, call.agente_nombre_bot);

    try {
      const [id] = await db('sofia_human_selections').insert({
        registro_llamada_id: call.registro_llamada_id,
        proyecto_id: call.proyecto_id,
        client_code: clientCode,
        agente_id: call.agente_id,
        agente_nombre: agenteNombre,
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

  /** Misma prioridad de _attachAgentNames, para un solo agente. */
  async _resolveSingleAgentName(agenteId, clientCode, botName) {
    if (botName) return botName;

    const agentRow = await db('recordings')
      .where('agent_id', agenteId)
      .whereNotNull('agent_name')
      .select('agent_name')
      .count('* as cnt')
      .groupBy('agent_name')
      .orderBy('cnt', 'desc')
      .first();
    if (agentRow) return agentRow.agent_name;

    try {
      const liveMap = await RealtimeScanService.getEmployeeNames([agenteId], clientCode);
      return liveMap.get(agenteId) || null;
    } catch (err) {
      logger.warn('SofiaHumanService: no se pudo resolver nombre en vivo', { message: err.message });
      return null;
    }
  }

  /**
   * Encuentra y audita automáticamente la continuación humana de una llamada
   * del bot: la llamada de agente humano en la cola correspondiente
   * (proyecto 7/9=Hogar, 10/11=TyT) con el MISMO teléfono, justo después de
   * que el bot colgó. Cacheado por bot_call_id — no depende de si ese agente
   * ya tiene otra selección esa semana (a diferencia de sofia_human_selections),
   * porque acá se necesita esa continuación exacta.
   */
  async findAndAnalyzeContinuation(botCallId, botProyectoId, telefono, fecha, hora) {
    const existing = await db('sofia_continuation_audits').where({ bot_call_id: botCallId }).first();
    // 'scored'/'error' son definitivos. 'not_found' solo es definitivo pasada
    // la ventana de reintento (NOT_FOUND_RETRY_WINDOW_MS) — antes de eso, el
    // agente humano puede simplemente no haber contestado todavía la cola.
    if (existing && existing.status !== 'not_found') return existing;
    if (existing && existing.status === 'not_found' && !this._isContinuationRetryDue(fecha, hora)) return existing;

    const clientCode = voicebotSource.clientCodeToProyecto
      ? Object.keys(voicebotSource.clientCodeToProyecto).find((cc) => voicebotSource.clientCodeToProyecto[cc] === botProyectoId)
      : null;
    const proyectoIds = clientCode ? proyectosForClientCodes([clientCode]) : [];

    let row = null;
    if (proyectoIds.length && telefono) {
      const pgClient = await this._connect();
      try {
        const result = await pgClient.query(
          `SELECT registro_llamada_id, proyecto_id, registro_llamada_fecha, registro_llamada_hora,
                  registro_llamada_fono, agente_id, time_speaking, audiofile,
                  json_data->>'agente' AS agente_nombre_bot
           FROM registro_llamada
           WHERE proyecto_id = ANY($1::int[]) AND registro_llamada_fono = $2
             AND registro_llamada_fecha = $3 AND registro_llamada_hora > $4
             AND time_speaking > 0
           ORDER BY registro_llamada_hora ASC
           LIMIT 1`,
          [proyectoIds, telefono, fecha, hora]
        );
        row = result.rows[0] || null;
      } finally {
        await pgClient.end().catch(() => {});
      }
    }

    if (!row) {
      const id = await this._upsertContinuation(existing?.id, { bot_call_id: botCallId, status: 'not_found' });
      return db('sofia_continuation_audits').where({ id }).first();
    }

    const call = this._mapRow(row);
    const agenteNombre = await this._resolveSingleAgentName(call.agente_id, clientCode, call.agente_nombre_bot);

    const baseRow = {
      bot_call_id: botCallId,
      registro_llamada_id: call.registro_llamada_id,
      proyecto_id: call.proyecto_id,
      client_code: clientCode,
      agente_id: call.agente_id,
      agente_nombre: agenteNombre,
      telefono: call.telefono,
      fecha: call.fecha,
      hora: call.hora,
      duracion: call.duracion,
      audiofile: call.audiofile,
    };

    if (!call.audiofile) {
      const id = await this._upsertContinuation(existing?.id, { ...baseRow, status: 'error', error_message: 'Sin audio disponible' });
      return db('sofia_continuation_audits').where({ id }).first();
    }

    let finalId;
    try {
      const rawBuffer = await downloadBuffer(this.getAudioUrl(call.audiofile));

      const tmpInput = path.join(os.tmpdir(), `sofia_cont_in_${Date.now()}.wav`);
      const tmpOutput = path.join(os.tmpdir(), `sofia_cont_out_${Date.now()}.ogg`);
      let audioBuffer;
      try {
        fs.writeFileSync(tmpInput, rawBuffer);
        await execFileAsync('ffmpeg', [
          '-y', '-i', tmpInput,
          '-acodec', 'libopus',
          '-ar', '16000',
          '-ac', '1',
          '-b:a', '32k',
          tmpOutput,
        ]);
        audioBuffer = fs.readFileSync(tmpOutput);
      } finally {
        try { fs.unlinkSync(tmpInput); } catch {}
        try { fs.unlinkSync(tmpOutput); } catch {}
      }

      const { transcription, evaluation } = await GeminiService.analyzeCall(
        audioBuffer,
        clientCode,
        call.agente_id,
        call.proyecto_id,
        'audio/ogg',
        null
      );

      finalId = await this._upsertContinuation(existing?.id, {
        ...baseRow,
        transcription: transcription || null,
        criteria_general: JSON.stringify(evaluation.general),
        criteria_high_impact: JSON.stringify(evaluation.highImpact),
        high_impact_failed: evaluation.highImpactFailed,
        score: evaluation.score,
        notes: evaluation.summary || null,
        status: 'scored',
      });
      logger.info(`SofiaHumanService: continuación auditada para bot_call_id ${botCallId}`, { score: evaluation.score });
    } catch (err) {
      // Cuota agotada: no hay nada más que hacer acá — se relanza para que
      // el llamador (VoicebotAuditRunner) lo detecte y detenga todo, igual
      // que ya hace con la auditoría del propio bot.
      if (err.isSpendingCap) throw err;

      logger.error(`SofiaHumanService: error auditando continuación de ${botCallId}`, err);
      finalId = await this._upsertContinuation(existing?.id, {
        ...baseRow,
        status: 'error',
        error_message: err.message || 'Error al auditar la continuación',
      });
    }

    return db('sofia_continuation_audits').where({ id: finalId }).first();
  }

  /** Ventana durante la cual reintentar un 'not_found' (el humano puede no haber contestado aún). */
  _isContinuationRetryDue(fecha, hora) {
    const NOT_FOUND_RETRY_WINDOW_MS = 3 * 60 * 60 * 1000; // 3 horas
    const fechaStr = fecha instanceof Date ? fecha.toISOString().slice(0, 10) : String(fecha).slice(0, 10);
    const horaStr = String(hora).slice(0, 8);
    const botTime = new Date(`${fechaStr}T${horaStr}`).getTime();
    if (Number.isNaN(botTime)) return true;
    return (Date.now() - botTime) < NOT_FOUND_RETRY_WINDOW_MS;
  }

  async _upsertContinuation(existingId, row) {
    if (existingId) {
      await db('sofia_continuation_audits').where({ id: existingId }).update({ ...row, updated_at: db.fn.now() });
      return existingId;
    }
    // onConflict/merge como red de seguridad: si dos llamadas concurrentes
    // (ej. el cron y alguien abriendo el modal a la vez) procesan el mismo
    // bot_call_id sin haberse visto la una a la otra todavía, la segunda no
    // revienta con duplicate key — simplemente actualiza la misma fila.
    await db('sofia_continuation_audits').insert(row).onConflict('bot_call_id').merge();
    const saved = await db('sofia_continuation_audits').where({ bot_call_id: row.bot_call_id }).first();
    return saved.id;
  }

  /**
   * Llamado desde VoicebotAuditRunner en cada corrida: busca y audita
   * automáticamente las continuaciones pendientes de un proyecto del bot,
   * sin que nadie tenga que abrir el modal. Candidatas: llamadas
   * transferidas de las últimas 4 horas, con al menos 5 minutos de
   * antigüedad (para dar tiempo a que la cola humana conteste), que no
   * tengan ya una continuación resuelta ('scored'/'error') ni un
   * 'not_found' todavía dentro de su ventana de reintento.
   */
  async processPendingContinuations(botProyectoId, limit = 20) {
    const pgClient = await this._connect();
    let candidates;
    try {
      const result = await pgClient.query(
        `SELECT call_id, fecha, hora, telefono
         FROM v_voicebot_result
         WHERE proyecto_id = $1 AND hangup_reason = 'call_transfer'
           AND fecha >= CURRENT_DATE - INTERVAL '1 day'
         ORDER BY fecha DESC, hora DESC
         LIMIT 500`,
        [botProyectoId]
      );
      candidates = result.rows;
    } finally {
      await pgClient.end().catch(() => {});
    }
    if (!candidates.length) return { processed: 0, spendingCapHit: false };

    const toDateStr = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
    const callIds = candidates.map((c) => c.call_id);
    const existingRows = await db('sofia_continuation_audits')
      .whereIn('bot_call_id', callIds)
      .select('bot_call_id', 'status');
    const existingMap = new Map(existingRows.map((r) => [r.bot_call_id, r.status]));

    const FIVE_MIN_MS = 5 * 60 * 1000;
    const now = Date.now();

    const pending = candidates.filter((c) => {
      const fechaStr = toDateStr(c.fecha);
      const horaStr = String(c.hora).slice(0, 8);
      const botTime = new Date(`${fechaStr}T${horaStr}`).getTime();
      if (!Number.isNaN(botTime) && (now - botTime) < FIVE_MIN_MS) return false; // muy reciente, aún no contestan

      const status = existingMap.get(c.call_id);
      if (!status) return true;
      if (status === 'scored' || status === 'error') return false;
      return this._isContinuationRetryDue(c.fecha, c.hora); // 'not_found' reintentable
    }).slice(0, limit);

    if (!pending.length) return { processed: 0, spendingCapHit: false };

    const results = await Promise.allSettled(
      pending.map((c) => this.findAndAnalyzeContinuation(c.call_id, botProyectoId, c.telefono, toDateStr(c.fecha), String(c.hora)))
    );

    const spendingCapHit = results.some((r) => r.status === 'rejected' && r.reason?.isSpendingCap);
    return { processed: pending.length, spendingCapHit };
  }

  /**
   * Historial de auditorías de Sofia IA ya seleccionadas/calificadas —
   * equivalente a AuditService.getWeekSelections, pero sin acotar a una
   * semana puntual (el volumen de este universo es mucho menor). Es la
   * forma de ver lo ya auditado sin depender de volver al día exacto de
   * la llamada original.
   */
  async listSelections({ clientCodes, status, dateFrom, dateTo, agente, telefono }) {
    const query = db('sofia_human_selections')
      .whereIn('client_code', clientCodes)
      .orderBy('fecha', 'desc')
      .orderBy('hora', 'desc')
      .limit(300);

    if (status) query.where('status', status);
    if (dateFrom) query.where('fecha', '>=', dateFrom);
    if (dateTo) query.where('fecha', '<=', dateTo);
    if (agente) {
      query.where((qb) => {
        qb.where('agente_id', 'like', `%${agente}%`).orWhere('agente_nombre', 'like', `%${agente}%`);
      });
    }
    if (telefono) query.where('telefono', 'like', `%${telefono}%`);

    return query;
  }

  async updateStatus(id, { status, notes }) {
    const update = { updated_at: db.fn.now() };
    if (status !== undefined) update.status = status;
    if (notes !== undefined) update.notes = notes;
    const affected = await db('sofia_human_selections').where({ id }).update(update);
    return affected > 0;
  }

  /**
   * A diferencia de v_voicebot_result (bot), donde audiofile ya trae la
   * extensión, en registro_llamada de estas colas humanas el valor guardado
   * no la incluye — el archivo real está en disco como "<audiofile>.WAV".
   */
  getAudioUrl(audiofile) {
    return `${voicebotSource.audioBaseUrl}/${audiofile}.WAV`;
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

  /**
   * Audita automáticamente con IA — mismo motor que "Auditorías" estándar
   * (GeminiService.analyzeCall contra la misma CRITERIA[client_code]), solo
   * que el audio se descarga de la fuente del bot en vez de Aware/Kraken.
   */
  async analyzeSelection(id) {
    const selection = await this.getSelectionById(id);
    if (!selection) {
      const err = new Error('Selección no encontrada');
      err.statusCode = 404;
      throw err;
    }
    if (!selection.audiofile) {
      const err = new Error('Esta llamada no tiene audio disponible');
      err.statusCode = 404;
      throw err;
    }

    const t0 = Date.now();
    const rawBuffer = await downloadBuffer(this.getAudioUrl(selection.audiofile));
    logger.info(`SofiaHumanService: audio descargado (${(rawBuffer.length / 1024).toFixed(0)} KB) en ${Date.now() - t0}ms`);

    // Convertir a opus 16kHz mono ~32kbps — igual que AnalysisService, evita
    // timeouts/truncamiento en Gemini con el WAV crudo.
    const tmpInput = path.join(os.tmpdir(), `sofia_ai_in_${Date.now()}.wav`);
    const tmpOutput = path.join(os.tmpdir(), `sofia_ai_out_${Date.now()}.ogg`);
    let audioBuffer;
    try {
      fs.writeFileSync(tmpInput, rawBuffer);
      await execFileAsync('ffmpeg', [
        '-y', '-i', tmpInput,
        '-acodec', 'libopus',
        '-ar', '16000',
        '-ac', '1',
        '-b:a', '32k',
        tmpOutput,
      ]);
      audioBuffer = fs.readFileSync(tmpOutput);
    } finally {
      try { fs.unlinkSync(tmpInput); } catch {}
      try { fs.unlinkSync(tmpOutput); } catch {}
    }

    const { transcription, evaluation } = await GeminiService.analyzeCall(
      audioBuffer,
      selection.client_code,
      selection.agente_id,
      selection.proyecto_id,
      'audio/ogg',
      null
    );

    await db('sofia_human_selections')
      .where({ id })
      .update({
        criteria_general: JSON.stringify(evaluation.general),
        criteria_high_impact: JSON.stringify(evaluation.highImpact),
        high_impact_failed: evaluation.highImpactFailed,
        score: evaluation.score,
        notes: evaluation.summary || null,
        transcription: transcription || null,
        status: 'completed',
        scored_at: db.fn.now(),
        updated_at: db.fn.now(),
      });

    logger.info(`SofiaHumanService: análisis IA completado para selección ${id}`, {
      score: evaluation.score,
      highImpactFailed: evaluation.highImpactFailed,
    });

    return { score: evaluation.score, highImpactFailed: evaluation.highImpactFailed, summary: evaluation.summary };
  }
}

module.exports = new SofiaHumanService();
