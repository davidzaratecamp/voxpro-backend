const router = require('express').Router();
const ctrl = require('../controllers/avaya.controller');

// Solo coordinador_avaya puede acceder
router.use((req, res, next) => {
  if (req.user?.role !== 'coordinador_avaya') {
    return res.status(403).json({ error: true, message: 'Acceso restringido a coordinadores Avaya' });
  }
  next();
});

// Agentes
router.get('/agents', ctrl.listAgents);
router.post('/agents', ctrl.createAgent);
router.patch('/agents/:id', ctrl.updateAgent);

// Grabaciones
router.post('/recordings/upload', ctrl.upload.single('file'), ctrl.uploadRecording);
router.get('/recordings', ctrl.getRecordings);

module.exports = router;
