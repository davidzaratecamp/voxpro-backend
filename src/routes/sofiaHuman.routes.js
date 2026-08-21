const router = require('express').Router();
const ctrl = require('../controllers/sofiaHuman.controller');

// Solo supervisor_calidad o gestor_usuarios pueden acceder
router.use((req, res, next) => {
  if (!['supervisor_calidad', 'gestor_usuarios'].includes(req.user?.role)) {
    return res.status(403).json({ error: true, message: 'Acceso restringido a supervisores de calidad' });
  }
  next();
});

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
