const router = require('express').Router();
const ctrl = require('../controllers/realtime.controller');

// Roles que pueden usar el módulo de tiempo real
const ALLOWED_ROLES = new Set([
  'auditor',
  'coordinator',
  'supervisor_calidad',
  'viewer_zoom',
  'coordinador_avaya',
  'formador',
]);

router.use((req, res, next) => {
  if (!ALLOWED_ROLES.has(req.user?.role)) {
    return res.status(403).json({ error: true, message: 'Acceso no autorizado' });
  }
  next();
});

router.get('/calls', ctrl.getCalls);
router.get('/agents', ctrl.getAgents);
router.get('/agent-calls', ctrl.getAgentCalls);
router.post('/select', ctrl.selectCall);

module.exports = router;
