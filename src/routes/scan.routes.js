const router = require('express').Router();
const ctrl = require('../controllers/scan.controller');

// POST /api/scan - lanza escaneo async (no bloquea)
router.post('/', ctrl.triggerScan);

// POST /api/scan/sync - lanza escaneo y espera resultado
router.post('/sync', ctrl.triggerScanSync);

// POST /api/scan/daily - escaneo + selección de auditorías (reemplaza cron manual)
router.post('/daily', ctrl.scanAndSelect);

// POST /api/scan/enrich - fuerza re-enriquecimiento de grabaciones pendientes
router.post('/enrich', ctrl.forceEnrich);

// GET /api/scan/diagnose?date=YYYY-MM-DD - diagnóstico de grabaciones para una fecha
router.get('/diagnose', ctrl.diagnose);

module.exports = router;
