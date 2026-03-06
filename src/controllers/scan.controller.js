const ScannerService = require('../services/ScannerService');
const AuditService = require('../services/AuditService');
const asyncHandler = require('../middleware/asyncHandler');
const db = require('../database/connection');
const AwareDBService = require('../services/AwareDBService');
const AWARE_SOURCES = require('../config/sources');

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

  // 2. Seleccionar auditorías para ese mismo día escaneado
  // Si no se pasó fecha, ScannerService usó "ayer" — usamos la misma lógica aquí
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const selectDate = date || yesterday.toISOString().slice(0, 10);
  const auditResult = await AuditService.selectForDay(selectDate, req.user.id);

  // El cleanup ya NO corre aquí — corre en el job nocturno (2 AM)
  // para que todos los coordinadores tengan el día entero para escanear.
  res.json({
    message: 'Escaneo y selección completados',
    data: { scan: scanResult, audit: auditResult },
  });
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
