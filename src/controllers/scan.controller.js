const ScannerService = require('../services/ScannerService');
const ZoomScannerService = require('../services/ZoomScannerService');
const AuditService = require('../services/AuditService');
const asyncHandler = require('../middleware/asyncHandler');
const db = require('../database/connection');
const AwareDBService = require('../services/AwareDBService');
const AWARE_SOURCES = require('../config/sources');
const { resolveAgentIds } = require('../utils/agentUtils');

const WCB_SUBCAMPAIGN_IDS = {
  hogar: [21, 22, 23, 27, 41, 44],
  movil: [24, 25, 26, 28, 40, 43],
  pymes: [36, 37, 38, 39, 42, 45],
};

const OBAMA_SUBCAMPAIGN_IDS = {
  ventas:   [2, 4, 5, 6, 7, 16, 17, 18, 19, 20, 21, 25, 27, 39, 81, 83, 87],
  customer: [8, 9, 10, 14, 15, 22, 23, 24, 28, 32, 37, 41, 42, 43, 44, 45],
};

const LV_SUBCAMPAIGN_IDS = {
  ventas:   [34, 26],       // LV-VENTAS, LV_OUT
  customer: [35, 33, 36],   // LV_CUSTOMER, INB_LV, LV_COBROS
};

exports.triggerScan = asyncHandler(async (req, res) => {
  const { date, full_scan } = req.body;

  // No bloquear la respuesta HTTP para escaneos largos
  res.json({
    message: 'Escaneo iniciado',
    params: { targetDate: date || 'ayer', fullScan: !!full_scan },
  });

  // Ejecutar en background
  ScannerService.run({
    targetDate: date,
    fullScan: !!full_scan,
  }).catch(() => {
    // El error ya se loguea dentro del servicio
  });
});

exports.triggerScanSync = asyncHandler(async (req, res) => {
  const { date, full_scan } = req.body;

  const result = await ScannerService.run({
    targetDate: date,
    fullScan: !!full_scan,
  });

  res.json({ message: 'Escaneo completado', data: result });
});


exports.scanAndSelect = asyncHandler(async (req, res) => {
  const { date } = req.body;

  // 1. Escanear grabaciones del día
  const scanResult = await ScannerService.run({ targetDate: date });

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const selectDate = date || yesterday.toISOString().slice(0, 10);

  // 2. Devolver lista de agentes con grabaciones ese día (filtrada por coordinador/formador)
  const agentIds = await resolveAgentIds(req.user.id);
  const clientCodes = req.user.client_codes || [];

  const agentsQuery = db('recordings as r')
    .join('aware_sources as s', 'r.aware_source_id', 's.id')
    .join('clients as c', 's.client_id', 'c.id')
    .where('r.file_date', selectDate)
    .whereNotNull('r.agent_id')
    .where('r.agent_id', '!=', '-1')
    .whereIn('c.code', clientCodes)
    .groupBy('r.agent_id')
    .select('r.agent_id', db.raw('MAX(r.agent_name) as agent_name'), db.raw('COUNT(*) as recording_count'))
    .orderBy('agent_name');

  if (agentIds) agentsQuery.whereIn('r.agent_id', agentIds);

  const agents = await agentsQuery;

  res.json({
    message: 'Escaneo completado',
    data: { scan: scanResult, agents, date: selectDate },
  });
});

exports.weekAgents = asyncHandler(async (req, res) => {
  const { week_start, subcampaign, client, coordinator_id } = req.query;
  const clientCodes = req.user.client_codes || [];
  const agentIds = await resolveAgentIds(req.user.id);

  // Calcular los 7 días de la semana
  const start = week_start ? new Date(week_start + 'T00:00:00') : (() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay() + 1); // lunes
    return d;
  })();
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }

  // Agentes por día para los días de la semana
  const agentsQuery = db('recordings as r')
    .join('aware_sources as s', 'r.aware_source_id', 's.id')
    .join('clients as c', 's.client_id', 'c.id')
    .whereIn('r.file_date', days)
    .whereNotNull('r.agent_id')
    .where('r.agent_id', '!=', '-1')
    .whereIn('c.code', clientCodes)
    .groupBy('r.file_date', 'r.agent_id', 'c.code')
    .select('r.file_date', 'r.agent_id', 'c.code as client_code', db.raw('MAX(r.agent_name) as agent_name'), db.raw('COUNT(*) as recording_count'));

  if (agentIds) agentsQuery.whereIn('r.agent_id', agentIds);

  // Ocultar grabaciones Zoom a usuarios sin zoom_enabled
  if (!req.user.zoom_enabled) agentsQuery.where('s.source_type', '!=', 'zoom');

  // Filtro por coordinador (solo supervisor_calidad lo puede usar)
  if (coordinator_id && (req.user.role === 'supervisor_calidad' || req.user.role === 'viewer_zoom')) {
    if (coordinator_id === '__unassigned__') {
      // Agentes sin coordinador: obtener todos los agent_ids asignados y excluirlos
      const allCoords = await db('users')
        .where('role', 'coordinator')
        .where('active', 1)
        .whereRaw(`JSON_OVERLAPS(client_codes, ?)`, [JSON.stringify(clientCodes)])
        .select('agent_ids');
      const assignedIds = allCoords.flatMap((c) => {
        const ids = typeof c.agent_ids === 'string' ? JSON.parse(c.agent_ids) : (c.agent_ids || []);
        return ids.map(String);
      });
      if (assignedIds.length > 0) agentsQuery.whereNotIn('r.agent_id', assignedIds);
    } else {
      const coord = await db('users').where('id', coordinator_id).select('agent_ids').first();
      const ids = coord?.agent_ids
        ? (typeof coord.agent_ids === 'string' ? JSON.parse(coord.agent_ids) : coord.agent_ids)
        : [];
      agentsQuery.whereIn('r.agent_id', ids.length > 0 ? ids : ['__none__']);
    }
  }

  if (subcampaign) {
    // Inferir cliente si no viene explícito (usuario con un solo cliente)
    const effectiveClient = client || (
      clientCodes.includes('obama') ? 'obama' :
      clientCodes.includes('lv')    ? 'lv'    :
      'claro_wcb'
    );
    let ids = null;
    if (effectiveClient === 'obama') ids = OBAMA_SUBCAMPAIGN_IDS[subcampaign];
    else if (effectiveClient === 'lv') ids = LV_SUBCAMPAIGN_IDS[subcampaign];
    else ids = WCB_SUBCAMPAIGN_IDS[subcampaign];
    if (ids) agentsQuery.whereIn('r.proyecto_id', ids);
  }

  const rows = await agentsQuery;

  // Agrupar por fecha
  const byDate = {};
  for (const row of rows) {
    const date = row.file_date instanceof Date
      ? row.file_date.toISOString().slice(0, 10)
      : String(row.file_date).slice(0, 10);
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push({
      agent_id: row.agent_id,
      agent_name: row.agent_name,
      client_code: row.client_code,
      recording_count: Number(row.recording_count),
    });
  }

  // Ordenar cada día por recording_count desc
  for (const date of Object.keys(byDate)) {
    byDate[date].sort((a, b) => b.recording_count - a.recording_count);
  }

  res.json({ data: byDate });
});

exports.forceEnrich = asyncHandler(async (req, res) => {
  res.json({ message: 'Enriquecimiento iniciado en background' });
  ScannerService._enrichNewRecordings().catch(() => {});
});

exports.diagnose = asyncHandler(async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'Falta parámetro ?date=YYYY-MM-DD' });

  // Agent IDs del usuario autenticado
  const userRow = await db('users').where('id', req.user.id).select('name', 'agent_ids').first();
  const agentIds = userRow?.agent_ids
    ? (typeof userRow.agent_ids === 'string' ? JSON.parse(userRow.agent_ids) : userRow.agent_ids)
    : null;

  // Total de grabaciones para esa fecha por fuente
  const bySource = await db('recordings as r')
    .join('aware_sources as s', 'r.aware_source_id', 's.id')
    .where('r.file_date', date)
    .groupBy('s.folder_name')
    .select(
      's.folder_name',
      db.raw('COUNT(*) as total'),
      db.raw('SUM(CASE WHEN r.agent_id IS NULL THEN 1 ELSE 0 END) as null_agent'),
      db.raw("SUM(CASE WHEN r.agent_id IS NOT NULL AND r.agent_id != '-1' THEN 1 ELSE 0 END) as with_agent"),
      db.raw('COUNT(DISTINCT r.agent_id) as distinct_agents')
    );

  // Cuántas grabaciones del día coinciden con los agent_ids del coordinador
  let myAgentsCount = null;
  let myAgentsDetail = null;
  if (agentIds && agentIds.length) {
    const rows = await db('recordings as r')
      .join('aware_sources as s', 'r.aware_source_id', 's.id')
      .join('clients as c', 's.client_id', 'c.id')
      .where('r.file_date', date)
      .whereIn('r.agent_id', agentIds)
      .groupBy('r.agent_id', 'r.agent_name', 'c.code')
      .select('r.agent_id', 'r.agent_name', 'c.code as client_code', db.raw('COUNT(*) as recordings'));
    myAgentsCount = rows.reduce((s, r) => s + Number(r.recordings), 0);
    myAgentsDetail = rows;
  }

  // Agentes presentes en la fecha desde fuentes claro_tyt (AWARE_8)
  const presentAgents = await db('recordings as r')
    .join('aware_sources as s', 'r.aware_source_id', 's.id')
    .where('r.file_date', date)
    .where('s.folder_name', 'AWARE_8')
    .whereNotNull('r.agent_id')
    .where('r.agent_id', '!=', '-1')
    .groupBy('r.agent_id', 'r.agent_name')
    .select('r.agent_id', 'r.agent_name', db.raw('COUNT(*) as recordings'))
    .orderBy('recordings', 'desc');

  // Estado de enriquecimiento para grabaciones sin agent_id en AWARE_8
  const [enrichStatus] = await db('recordings as r')
    .join('aware_sources as s', 'r.aware_source_id', 's.id')
    .where('r.file_date', date)
    .where('s.folder_name', 'AWARE_8')
    .whereNull('r.agent_id')
    .select(
      db.raw('SUM(CASE WHEN r.agent_enriched = 0 AND r.call_id IS NOT NULL THEN 1 ELSE 0 END) as pending_enrich'),
      db.raw('SUM(CASE WHEN r.agent_enriched = 0 AND r.call_id IS NULL THEN 1 ELSE 0 END) as no_call_id'),
      db.raw('SUM(CASE WHEN r.agent_enriched = 1 THEN 1 ELSE 0 END) as enriched_but_no_agent')
    );

  // Consulta directa a AwareDB para ver si los agentes del coordinador tienen llamadas ese día
  let awareDbResult = null;
  if (agentIds && agentIds.length) {
    const tytSource = AWARE_SOURCES.find((s) => s.folder === 'AWARE_8');
    if (tytSource) {
      awareDbResult = await AwareDBService.checkAgentsOnDate(tytSource, agentIds, date);
    }
  }

  res.json({
    date,
    user: userRow?.name,
    assigned_agent_ids: agentIds,
    recordings_by_source: bySource,
    my_agents_on_date: { count: myAgentsCount, detail: myAgentsDetail },
    all_agents_in_aware8: presentAgents,
    aware8_null_agent_breakdown: enrichStatus,
    awaredb_direct_check: awareDbResult,
  });
});

// POST /api/scan/zoom — escaneo manual de grabaciones Zoom para una fecha
exports.triggerZoomScan = asyncHandler(async (req, res) => {
  const { date } = req.body;
  const result = await ZoomScannerService.run({ targetDate: date || null });
  res.json({ message: 'Escaneo Zoom completado', data: result });
});
