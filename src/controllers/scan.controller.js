const ScannerService = require('../services/ScannerService');
const AuditService = require('../services/AuditService');
const asyncHandler = require('../middleware/asyncHandler');

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
