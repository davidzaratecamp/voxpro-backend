const crypto = require('crypto');
const db = require('../database/connection');
const asyncHandler = require('../middleware/asyncHandler');
const RealtimeScanService = require('../services/RealtimeScanService');
const logger = require('../utils/logger');
const { resolveAgentIds } = require('../utils/agentUtils');

function getWeekBounds(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const ref = new Date(Date.UTC(y, m - 1, d));
  const day = ref.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(ref);
  monday.setUTCDate(ref.getUTCDate() - diff);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    weekStart: monday.toISOString().slice(0, 10),
    weekEnd:   sunday.toISOString().slice(0, 10),
  };
}

/**
 * GET /api/realtime/calls?date=YYYY-MM-DD
 * Consulta las bases de datos Aware en tiempo real para el día indicado.
 */
exports.getCalls = asyncHandler(async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const clientCodes = req.user.client_codes || [];

  const calls = await RealtimeScanService.getCalls(date, clientCodes);

  res.json({ data: calls, count: calls.length, date });
});

/**
 * POST /api/realtime/select
 * Crea un recording + audit_selection para una llamada en tiempo real,
 * permitiendo luego auditarla con el flujo normal.
 *
 * Body: { call } — objeto call devuelto por getCalls
 */
/**
 * GET /api/realtime/agents?date=YYYY-MM-DD
 * Devuelve los agentes con llamadas en Aware para esa fecha, agrupados.
 */
exports.getAgents = asyncHandler(async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const clientCodes = req.user.client_codes || [];

  const calls = await RealtimeScanService.getCalls(date, clientCodes);

  // Resolver agent_ids permitidos (null = sin restricción, [] = ninguno, [ids...] = filtrar)
  const allowedIds = await resolveAgentIds(req.user.id);
  const allowedSet = allowedIds ? new Set(allowedIds.map(String)) : null;

  const agentMap = new Map();
  for (const call of calls) {
    // Ignorar llamadas sin agente asignado o con IDs inválidos (e.g. -1)
    if (!call.agent_id || Number(call.agent_id) < 0) continue;
    // Filtrar por agents asignados (coordinador / formador)
    if (allowedSet && !allowedSet.has(String(call.agent_id))) continue;
    const key = call.agent_id;
    if (!agentMap.has(key)) {
      agentMap.set(key, {
        agent_id:        call.agent_id,
        agent_name:      call.agent_name,
        client_code:     call.clientCode,
        recording_count: 0,
      });
    }
    agentMap.get(key).recording_count++;
  }

  const agents = Array.from(agentMap.values())
    .sort((a, b) => (a.agent_name || '').localeCompare(b.agent_name || ''));

  res.json({ data: agents, count: agents.length, date });
});

/**
 * GET /api/realtime/agent-calls?agent_id=X&date=YYYY-MM-DD
 * Devuelve top-20 llamadas >1min del agente, con info de selección si ya existe.
 */
exports.getAgentCalls = asyncHandler(async (req, res) => {
  const { agent_id, date } = req.query;
  if (!agent_id || !date) {
    return res.status(400).json({ error: true, message: 'agent_id y date son requeridos' });
  }
  const clientCodes = req.user.client_codes || [];

  const calls = await RealtimeScanService.getCallsByAgent(date, agent_id, clientCodes);

  const hashes = calls.map((c) => crypto.createHash('sha256').update(c.audio_url).digest('hex'));

  const existing = await db('recordings as r')
    .leftJoin('audit_selections as a', function () {
      this.on('a.recording_id', '=', 'r.id')
          .andOn('a.auditor_id', '=', db.raw('?', [req.user.id]));
    })
    .whereIn('r.file_path_hash', hashes)
    .select('r.file_path_hash', 'a.id as selection_id', 'a.status as selection_status');

  const existingMap = {};
  for (const row of existing) {
    existingMap[row.file_path_hash] = row;
  }

  const data = calls.map((call, i) => ({
    id:               null,
    call_duration:    call.duration,
    call_phone:       call.call_phone,
    selection_id:     existingMap[hashes[i]]?.selection_id || null,
    selection_status: existingMap[hashes[i]]?.selection_status || null,
    _realtime_call:   call,
  }));

  res.json({ data, count: data.length });
});

exports.selectCall = asyncHandler(async (req, res) => {
  const { call } = req.body;
  if (!call?.audio_url || !call?.file_date) {
    return res.status(400).json({ error: true, message: 'Datos de llamada incompletos' });
  }

  // Buscar aware_source_id por folder_name y cliente
  const source = await db('aware_sources as s')
    .join('clients as c', 's.client_id', 'c.id')
    .where('s.folder_name', call.folder)
    .where('c.code', call.clientCode)
    .select('s.id')
    .first();

  if (!source) {
    return res.status(500).json({ error: true, message: `Fuente no encontrada: ${call.folder} / ${call.clientCode}` });
  }

  const pathHash = crypto.createHash('sha256').update(call.audio_url).digest('hex');

  // Evitar duplicados
  const existing = await db('recordings').where('file_path_hash', pathHash).first();
  if (existing) {
    const existingSelection = await db('audit_selections')
      .where('recording_id', existing.id)
      .where('auditor_id', req.user.id)
      .first();
    if (existingSelection) {
      return res.json({
        message: 'Ya existe una selección para esta grabación',
        data: { recording_id: existing.id, selection_id: existingSelection.id },
      });
    }
  }

  const { weekStart, weekEnd } = getWeekBounds(String(call.file_date).slice(0, 10));

  await db.transaction(async (trx) => {
    let recordingId;

    if (existing) {
      recordingId = existing.id;
    } else {
      [recordingId] = await trx('recordings').insert({
        aware_source_id: source.id,
        file_name:       call.file_name,
        file_path:       call.audio_url,
        file_path_hash:  pathHash,
        file_date:       call.file_date,
        agent_id:        call.agent_id,
        agent_name:      call.agent_name,
        call_duration:   call.duration || null,
        proyecto_id:     call.proyecto_id || null,
        agent_enriched:  true,
        status:          'pending',
      });
    }

    const [selectionId] = await trx('audit_selections').insert({
      recording_id: recordingId,
      auditor_id:   req.user.id,
      agent_id:     call.agent_id,
      agent_name:   call.agent_name || '',
      client_code:  call.clientCode,
      week_start:   weekStart,
      week_end:     weekEnd,
      status:       'selected',
      score:        0,
    });

    logger.info(`Realtime: selección ${selectionId} creada para ${call.audio_url}`);

    res.status(201).json({
      message: 'Grabación seleccionada para auditoría',
      data: { recording_id: recordingId, selection_id: selectionId },
    });
  });
});
