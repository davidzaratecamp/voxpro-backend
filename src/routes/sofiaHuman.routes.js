const router = require('express').Router();
const ctrl = require('../controllers/sofiaHuman.controller');

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ error: true, message: 'Acceso restringido' });
    }
    next();
  };
}

// "Continuidad" (resultado comercial): también lo ven las cuentas auditor_ia
// (ia.tyt.demo/ia.hogar.demo) — acotado igual por sus client_codes. Va antes
// del gate general para no heredar su restricción a supervisor_calidad/gestor_usuarios.
router.get('/commercial-stats', requireRole('supervisor_calidad', 'gestor_usuarios', 'auditor_ia'), ctrl.getCommercialStats);

// "Feedback" (historial de lo entregado a los agentes): también lo ven las
// cuentas auditor_ia — mismo motivo que commercial-stats arriba.
router.get('/feedback', requireRole('supervisor_calidad', 'gestor_usuarios', 'auditor_ia'), ctrl.getFeedback);

// "Calificación de agentes": promedio semanal por agente sobre las
// continuaciones calificadas por la IA y el detalle de cada auditoría —
// mismos roles que Continuidad.
router.get('/agents-weekly', requireRole('supervisor_calidad', 'gestor_usuarios', 'auditor_ia'), ctrl.getAgentWeekly);
router.get('/agents-weekly/:agenteId/audits', requireRole('supervisor_calidad', 'gestor_usuarios', 'auditor_ia'), ctrl.listAgentWeekAudits);
router.get('/continuations/:id', requireRole('supervisor_calidad', 'gestor_usuarios', 'auditor_ia'), ctrl.getContinuationAudit);
router.get('/continuations/:id/audio', requireRole('supervisor_calidad', 'gestor_usuarios', 'auditor_ia'), ctrl.streamContinuationAudio);

// El resto del módulo (seleccionar/auditar llamadas humanas) es solo para
// quien audita al agente humano — auditor_ia no lo usa.
router.use(requireRole('supervisor_calidad', 'gestor_usuarios'));

router.get('/calls', ctrl.list);
router.post('/select', ctrl.select);
router.get('/selections', ctrl.listSelections);

router.get('/selections/:id', ctrl.getById);
router.patch('/selections/:id', ctrl.update);
router.get('/selections/:id/audio', ctrl.streamAudio);
router.post('/selections/:id/score', ctrl.saveScore);
router.post('/selections/:id/analyze', ctrl.analyze);

router.get('/criteria/:clientCode', ctrl.getCriteriaTemplate);

module.exports = router;
