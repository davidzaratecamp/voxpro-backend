const multer = require('multer');
const asyncHandler = require('../middleware/asyncHandler');
const SantiService = require('../services/SantiService');
const SantiAuditRunner = require('../services/SantiAuditRunner');

// Excel en memoria (archivos pequeños, ~1500 filas) — se parsea directo, no se guarda en disco.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
exports.upload = upload;

// POST /api/santi/import — sube el Excel de campaña (ej. P21 BOX PRO)
exports.importExcel = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: true, message: 'Falta el archivo Excel (campo "file")' });
  }
  const result = await SantiService.importFromExcel(req.file.buffer, req.file.originalname);
  res.json({ message: 'Importación completada', data: result });
});

// GET /api/santi/summary — conteos por estado, para el resumen de progreso
exports.getSummary = asyncHandler(async (req, res) => {
  const data = await SantiService.getSummary();
  res.json({ data });
});

// GET /api/santi/audits?status=&phone=&page=
exports.list = asyncHandler(async (req, res) => {
  const { status, phone, page } = req.query;
  const data = await SantiService.list({ status, phone, page: page ? Number(page) : 1 });
  res.json(data);
});

// GET /api/santi/export — igual que list() pero sin paginar, para armar el Excel en el frontend
exports.exportRows = asyncHandler(async (req, res) => {
  const { status, phone } = req.query;
  const data = await SantiService.exportRows({ status, phone });
  res.json({ data });
});

// POST /api/santi/process — dispara un lote manualmente (además del cron automático)
exports.process = asyncHandler(async (req, res) => {
  SantiAuditRunner.runPendingBatch(); // fire-and-forget, no bloquea la respuesta
  res.json({ message: 'Procesamiento de lote iniciado' });
});
