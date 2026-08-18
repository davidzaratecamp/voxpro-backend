const router = require('express').Router();
const ctrl = require('../controllers/voicebot.controller');

// Solo auditor_ia o gestor_usuarios pueden acceder
router.use((req, res, next) => {
  if (!['auditor_ia', 'gestor_usuarios'].includes(req.user?.role)) {
    return res.status(403).json({ error: true, message: 'Acceso restringido a auditores de IA' });
  }
  next();
});

router.get('/calls', ctrl.list);
router.get('/calls/:callId', ctrl.getById);
router.get('/calls/:callId/audio', ctrl.streamAudio);
router.get('/calls/:callId/audit', ctrl.getCallAudit);

router.get('/prompts', ctrl.getPrompts);
router.put('/prompts/:proyectoId', ctrl.savePrompt);

router.get('/audit-settings', ctrl.getAuditSettings);
router.post('/audit-settings/:proyectoId/enable', ctrl.enableAutoAudit);
router.post('/audit-settings/:proyectoId/disable', ctrl.disableAutoAudit);

router.get('/stats', ctrl.getStats);

module.exports = router;
