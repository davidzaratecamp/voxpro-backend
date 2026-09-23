const router = require('express').Router();
const ctrl = require('../controllers/obamaVital.controller');

// Módulo exclusivo de Obama Vital (asiste2.awareccm.com). Todo el equipo
// auditor_obama_vital comparte las auditorías; gestor_usuarios entra como admin.
router.use((req, res, next) => {
  const isAuditor = req.user?.role === 'auditor_obama_vital' && req.user?.client_codes?.includes('obama_vital');
  if (!isAuditor && req.user?.role !== 'gestor_usuarios') {
    return res.status(403).json({ error: true, message: 'Acceso restringido' });
  }
  next();
});

router.get('/calls', ctrl.listCalls);
router.post('/select', ctrl.select);
router.get('/audits', ctrl.listAudits);
router.get('/summary', ctrl.summary);
router.get('/audits/:id', ctrl.getById);
router.patch('/audits/:id', ctrl.update);
router.get('/audits/:id/audio', ctrl.streamAudio);
router.post('/audits/:id/score', ctrl.saveScore);
router.post('/audits/:id/analyze', ctrl.analyze);
router.get('/criteria/:campaign', ctrl.getCriteriaTemplate);

module.exports = router;
