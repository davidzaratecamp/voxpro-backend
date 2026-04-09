const crypto = require('crypto');
const db = require('../database/connection');
const asyncHandler = require('../middleware/asyncHandler');
const RealtimeScanService = require('../services/RealtimeScanService');
const logger = require('../utils/logger');

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
