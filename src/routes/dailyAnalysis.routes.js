const router = require('express').Router();
const ctrl = require('../controllers/dailyAnalysis.controller');

const ALLOWED_ROLES = new Set(['auditor', 'coordinator', 'supervisor_calidad', 'viewer_zoom', 'coordinador_avaya', 'formador']);

router.use((req, res, next) => {
  if (!ALLOWED_ROLES.has(req.user?.role)) {
    return res.status(403).json({ error: true, message: 'Acceso no autorizado' });
  }
  next();
});

router.get('/metrics', ctrl.getMetrics);
router.post('/ai-summary', ctrl.getAiSummary);

module.exports = router;
