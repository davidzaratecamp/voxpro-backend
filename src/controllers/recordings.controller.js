const RecordingService = require('../services/RecordingService');
const asyncHandler = require('../middleware/asyncHandler');

exports.list = asyncHandler(async (req, res) => {
  const {
    client,
    source_id,
    status,
    date_from,
    date_to,
    search,
    agent_id,
    page,
    limit,
    sort_by,
    sort_dir,
  } = req.query;

  const result = await RecordingService.list({
    clientCode: client,
    sourceId: source_id,
    status,
    dateFrom: date_from,
    dateTo: date_to,
    search,
    agentId: agent_id,
    page: parseInt(page) || 1,
    limit: Math.min(parseInt(limit) || 50, 200),
    sortBy: sort_by,
    sortDir: sort_dir,
  });

  res.json(result);
});

exports.getById = asyncHandler(async (req, res) => {
  const recording = await RecordingService.getById(req.params.id);
  if (!recording) {
    return res.status(404).json({ error: true, message: 'Grabación no encontrada' });
  }
  res.json({ data: recording });
});

exports.updateStatus = asyncHandler(async (req, res) => {
  const { status, error_message } = req.body;
  const validStatuses = ['pending', 'processing', 'transcribed', 'analyzed', 'error', 'skipped'];

  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({
      error: true,
      message: `Estado inválido. Valores permitidos: ${validStatuses.join(', ')}`,
    });
  }

  const updated = await RecordingService.updateStatus(
    req.params.id,
    status,
    error_message
  );

  if (!updated) {
    return res.status(404).json({ error: true, message: 'Grabación no encontrada' });
  }

  res.json({ message: 'Estado actualizado', data: { id: req.params.id, status } });
});

exports.byAgent = asyncHandler(async (req, res) => {
  const { agent_id, date } = req.query;
  if (!agent_id || !date) {
    return res.status(400).json({ error: true, message: 'Faltan parámetros agent_id y date' });
  }
  const clientCodes = req.user.client_codes || [];
  const db = require('../database/connection');

  const recordings = await db('recordings as r')
    .join('aware_sources as s', 'r.aware_source_id', 's.id')
    .join('clients as c', 's.client_id', 'c.id')
    .leftJoin('audit_selections as a', function () {
      this.on('a.recording_id', 'r.id').andOn('a.auditor_id', db.raw('?', [req.user.id]));
    })
    .where('r.agent_id', agent_id)
    .where('r.file_date', date)
    .whereIn('c.code', clientCodes)
    .modify((q) => {
      if (clientCodes.includes('obama')) {
        q.where('r.call_duration', '>', 0).limit(20);
      } else if (!clientCodes.includes('lv')) {
        q.where('r.file_size', '>=', 10240).limit(20);
      }
    })
    .orderBy('r.call_duration', 'desc')
    .select(
      'r.id', 'r.file_name', 'r.call_duration',
      'r.file_date', 'r.call_phone', 'r.agent_name', 'r.agent_id',
      'c.code as client_code',
      'a.id as selection_id', 'a.status as selection_status'
    );

  res.json({ data: recordings });
});

exports.byAgentPhone = asyncHandler(async (req, res) => {
  const { agent_id, date, phone } = req.query;
  if (!agent_id || !date || !phone) {
    return res.status(400).json({ error: true, message: 'Faltan parámetros agent_id, date y phone' });
  }
  const clientCodes = req.user.client_codes || [];
  const db = require('../database/connection');

  const recordings = await db('recordings as r')
    .join('aware_sources as s', 'r.aware_source_id', 's.id')
    .join('clients as c', 's.client_id', 'c.id')
    .leftJoin('audit_selections as a', function () {
      this.on('a.recording_id', 'r.id').andOn('a.auditor_id', db.raw('?', [req.user.id]));
    })
    .where('r.agent_id', agent_id)
    .where('r.file_date', date)
    .where('r.call_phone', phone)
    .whereIn('c.code', clientCodes)
    .orderBy('r.call_duration', 'desc')
    .select(
      'r.id', 'r.file_name', 'r.call_duration',
      'r.file_date', 'r.call_phone', 'r.agent_name', 'r.agent_id',
      'c.code as client_code',
      'a.id as selection_id', 'a.status as selection_status'
    );

  res.json({ data: recordings });
});

exports.getPending = asyncHandler(async (req, res) => {
  const { client, limit } = req.query;
  const recordings = await RecordingService.getPending({
    clientCode: client,
    limit: Math.min(parseInt(limit) || 100, 500),
  });
  res.json({ data: recordings, count: recordings.length });
});
