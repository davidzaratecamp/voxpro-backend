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

exports.getPending = asyncHandler(async (req, res) => {
  const { client, limit } = req.query;
  const recordings = await RecordingService.getPending({
    clientCode: client,
    limit: Math.min(parseInt(limit) || 100, 500),
  });
  res.json({ data: recordings, count: recordings.length });
});
