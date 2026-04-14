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
  const isObama = clientCodes.includes('obama');

  const baseQuery = () => db('recordings as r')
    .join('aware_sources as s', 'r.aware_source_id', 's.id')
    .join('clients as c', 's.client_id', 'c.id')
    .leftJoin('audit_selections as a', function () {
      this.on('a.recording_id', 'r.id').andOn('a.auditor_id', db.raw('?', [req.user.id]));
    })
    .where('r.agent_id', agent_id)
    .where('r.file_date', date)
    .whereIn('c.code', clientCodes)
    .orderBy('r.call_duration', 'desc')
    .select(
      'r.id', 'r.file_name', 'r.call_duration',
      'r.file_date', 'r.call_phone', 'r.agent_name', 'r.agent_id',
      'c.code as client_code', 's.source_type',
      'a.id as selection_id', 'a.status as selection_status'
    );

  // Obama con zoom_enabled: devolver 10 Aware + 10 Zoom por separado.
  // Las grabaciones Aware de agentes Obama pueden estar bajo cualquier cliente
  // (obama, claro_hogar, lv…), por eso no aplicamos el filtro de clientCodes
  // en el lado Aware — mostramos todas las del agente ese día.
  if (isObama && req.user.zoom_enabled) {
    const awareQuery = () => db('recordings as r')
      .join('aware_sources as s', 'r.aware_source_id', 's.id')
      .join('clients as c', 's.client_id', 'c.id')
      .leftJoin('audit_selections as a', function () {
        this.on('a.recording_id', 'r.id').andOn('a.auditor_id', db.raw('?', [req.user.id]));
      })
      .where('r.agent_id', agent_id)
      .where('r.file_date', date)
      .where('s.source_type', '!=', 'zoom')
      .where('r.call_duration', '>', 0)
      .orderBy('r.call_duration', 'desc')
      .select(
        'r.id', 'r.file_name', 'r.call_duration',
        'r.file_date', 'r.call_phone', 'r.agent_name', 'r.agent_id',
        'c.code as client_code', 's.source_type',
        'a.id as selection_id', 'a.status as selection_status'
      )
      .limit(10);

    const selectCols = [
      'r.id', 'r.file_name', 'r.call_duration',
      'r.file_date', 'r.call_phone', 'r.agent_name', 'r.agent_id',
      'c.code as client_code', 's.source_type',
      'a.id as selection_id', 'a.status as selection_status',
    ];

    const auditedByUser = () => db('recordings as r')
      .join('aware_sources as s', 'r.aware_source_id', 's.id')
      .join('clients as c', 's.client_id', 'c.id')
      .join('audit_selections as a', function () {
        this.on('a.recording_id', 'r.id').andOn('a.auditor_id', db.raw('?', [req.user.id]));
      })
      .where('r.agent_id', agent_id)
      .where('r.file_date', date)
      .select(selectCols);

    const [aware, zoom, auditedRows] = await Promise.all([
      awareQuery(),
      baseQuery().where('s.source_type', 'zoom').where('r.call_duration', '>', 180).limit(10),
      auditedByUser(),
    ]);

    // Agregar grabaciones auditadas (desde búsqueda) que no estén ya en el top 10
    const awareIds  = new Set(aware.map((r) => r.id));
    const zoomIds   = new Set(zoom.map((r) => r.id));
    for (const row of auditedRows) {
      if (row.source_type === 'zoom' && !zoomIds.has(row.id)) zoom.push(row);
      if (row.source_type !== 'zoom' && !awareIds.has(row.id)) aware.push(row);
    }

    return res.json({ data: aware, zoom_data: zoom });
  }

  // Resto de clientes o usuarios sin zoom_enabled
  const recordings = await baseQuery().modify((q) => {
    if (!req.user.zoom_enabled) q.where('s.source_type', '!=', 'zoom');
    if (isObama) {
      q.where('r.call_duration', '>', 0).limit(20);
    } else if (!clientCodes.includes('lv')) {
      q.where('r.file_size', '>=', 10240).limit(20);
    }
  });

  res.json({ data: recordings });
});

exports.byAgentPhone = asyncHandler(async (req, res) => {
  const { agent_id, date, phone, source } = req.query;
  if (!agent_id || !date || !phone) {
    return res.status(400).json({ error: true, message: 'Faltan parámetros agent_id, date y phone' });
  }
  const clientCodes = req.user.client_codes || [];
  const db = require('../database/connection');
  const crypto = require('crypto');

  // Zoom: siempre desde voxpro DB
  if (source === 'zoom') {
    const recordings = await db('recordings as r')
      .join('aware_sources as s', 'r.aware_source_id', 's.id')
      .join('clients as c', 's.client_id', 'c.id')
      .leftJoin('audit_selections as a', function () {
        this.on('a.recording_id', 'r.id').andOn('a.auditor_id', db.raw('?', [req.user.id]));
      })
      .where('r.agent_id', agent_id)
      .where('r.file_date', date)
      .where('r.call_phone', 'like', `%${phone.trim()}%`)
      .where('s.source_type', 'zoom')
      .orderBy('r.call_duration', 'desc')
      .select(
        'r.id', 'r.file_name', 'r.call_duration',
        'r.file_date', 'r.call_phone', 'r.agent_name', 'r.agent_id',
        'c.code as client_code', 's.source_type',
        'a.id as selection_id', 'a.status as selection_status'
      );
    return res.json({ data: recordings });
  }

  // Aware: buscar en Kraken en tiempo real
  const RealtimeScanService = require('../services/RealtimeScanService');
  const calls = await RealtimeScanService.getCallsByPhone(date, phone.trim(), clientCodes);
  const agentCalls = calls.filter((c) => String(c.agent_id) === String(agent_id));

  const hashes = agentCalls.map((c) => crypto.createHash('sha256').update(c.audio_url).digest('hex'));
  const existing = hashes.length
    ? await db('recordings as r')
        .leftJoin('audit_selections as a', function () {
          this.on('a.recording_id', 'r.id').andOn('a.auditor_id', db.raw('?', [req.user.id]));
        })
        .whereIn('r.file_path_hash', hashes)
        .select('r.file_path_hash', 'a.id as selection_id', 'a.status as selection_status')
    : [];

  const existingMap = {};
  for (const row of existing) existingMap[row.file_path_hash] = row;

  const data = agentCalls.map((call, i) => ({
    id:               null,
    call_duration:    call.duration,
    call_phone:       call.call_phone,
    file_date:        call.file_date,
    agent_id:         call.agent_id,
    agent_name:       call.agent_name,
    client_code:      call.clientCode,
    source_type:      'aware',
    selection_id:     existingMap[hashes[i]]?.selection_id || null,
    selection_status: existingMap[hashes[i]]?.selection_status || null,
    _realtime_call:   call,
  }));

  res.json({ data });
});

exports.byPhone = asyncHandler(async (req, res) => {
  const { phone, source } = req.query;
  if (!phone || phone.trim().length < 7) {
    return res.status(400).json({ error: true, message: 'Ingresa al menos 7 dígitos' });
  }
  const clientCodes = req.user.client_codes || [];
  const db = require('../database/connection');
  const crypto = require('crypto');

  // Tab Aware con zoom_enabled: buscar en Kraken para hoy + DB para auditadas históricas
  if (source !== 'zoom' && req.user.zoom_enabled) {
    const today = new Date().toISOString().slice(0, 10);
    const RealtimeScanService = require('../services/RealtimeScanService');

    const [krakenCalls, dbRecordings] = await Promise.all([
      RealtimeScanService.getCallsByPhone(today, phone.trim(), clientCodes),
      db('recordings as r')
        .join('aware_sources as s', 'r.aware_source_id', 's.id')
        .join('clients as c', 's.client_id', 'c.id')
        .join('audit_selections as a', function () {
          this.on('a.recording_id', 'r.id').andOn('a.auditor_id', db.raw('?', [req.user.id]));
        })
        .where('r.call_phone', 'like', `%${phone.trim()}%`)
        .whereIn('c.code', clientCodes)
        .where('s.source_type', '!=', 'zoom')
        .orderBy('r.file_date', 'desc')
        .limit(50)
        .select(
          'r.id', 'r.file_name', 'r.call_duration',
          'r.file_date', 'r.call_phone', 'r.agent_name', 'r.agent_id',
          'c.code as client_code', 'c.name as client_name',
          db.raw("'aware' as source_type"),
          'a.id as selection_id', 'a.status as selection_status'
        ),
    ]);

    // Cruzar Kraken con DB para ver selection status
    const hashes = krakenCalls.map((c) => crypto.createHash('sha256').update(c.audio_url).digest('hex'));
    const existing = hashes.length
      ? await db('recordings as r')
          .leftJoin('audit_selections as a', function () {
            this.on('a.recording_id', 'r.id').andOn('a.auditor_id', db.raw('?', [req.user.id]));
          })
          .whereIn('r.file_path_hash', hashes)
          .select('r.file_path_hash', 'a.id as selection_id', 'a.status as selection_status')
      : [];
    const existingMap = {};
    for (const row of existing) existingMap[row.file_path_hash] = row;

    const krakenData = krakenCalls.map((call, i) => ({
      id:               null,
      call_duration:    call.duration,
      call_phone:       call.call_phone,
      file_date:        call.file_date,
      agent_id:         call.agent_id,
      agent_name:       call.agent_name,
      client_code:      call.clientCode,
      source_type:      'aware',
      selection_id:     existingMap[hashes[i]]?.selection_id || null,
      selection_status: existingMap[hashes[i]]?.selection_status || null,
      _realtime_call:   call,
    }));

    // Combinar: Kraken (hoy) primero, luego auditadas históricas
    const dbHashes = new Set(krakenCalls.map((c) => c.audio_url));
    const combined = [
      ...krakenData,
      ...dbRecordings,
    ];

    return res.json({ data: combined, count: combined.length });
  }

  // Zoom o usuarios sin zoom_enabled: siempre desde voxpro DB
  const recordings = await db('recordings as r')
    .join('aware_sources as s', 'r.aware_source_id', 's.id')
    .join('clients as c', 's.client_id', 'c.id')
    .leftJoin('audit_selections as a', function () {
      this.on('a.recording_id', 'r.id').andOn('a.auditor_id', db.raw('?', [req.user.id]));
    })
    .where('r.call_phone', 'like', `%${phone.trim()}%`)
    .whereIn('c.code', clientCodes)
    .modify((q) => {
      if (source === 'zoom') {
        q.where('s.source_type', 'zoom');
      } else {
        q.where('s.source_type', '!=', 'zoom');
      }
    })
    .orderBy('r.file_date', 'desc')
    .limit(50)
    .select(
      'r.id', 'r.file_name', 'r.call_duration',
      'r.file_date', 'r.call_phone', 'r.agent_name', 'r.agent_id',
      'c.code as client_code', 'c.name as client_name',
      's.source_type',
      'a.id as selection_id', 'a.status as selection_status'
    );

  res.json({ data: recordings, count: recordings.length });
});

exports.getPending = asyncHandler(async (req, res) => {
  const { client, limit } = req.query;
  const recordings = await RecordingService.getPending({
    clientCode: client,
    limit: Math.min(parseInt(limit) || 100, 500),
  });
  res.json({ data: recordings, count: recordings.length });
});
