const router = require('express').Router();
const ctrl = require('../controllers/voicebot.controller');

// Solo auditor_ia puede acceder
router.use((req, res, next) => {
  if (req.user?.role !== 'auditor_ia') {
    return res.status(403).json({ error: true, message: 'Acceso restringido a auditores de IA' });
  }
  next();
});

router.get('/calls', ctrl.list);
router.get('/calls/:callId', ctrl.getById);
router.get('/calls/:callId/audio', ctrl.streamAudio);

module.exports = router;
