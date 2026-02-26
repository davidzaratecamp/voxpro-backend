const router = require('express').Router();
const ctrl = require('../controllers/audit.controller');

router.post('/select', ctrl.select);
router.get('/selections', ctrl.list);
router.get('/selections/:id', ctrl.getById);
router.patch('/selections/:id', ctrl.update);
router.post('/selections/:id/analyze', ctrl.analyze);
router.get('/selections/:id/analysis', ctrl.getAnalysis);
router.patch('/selections/:id/analysis', ctrl.updateAnalysis);
router.get('/selections/:id/audio', ctrl.streamAudio);
router.get('/agents-performance', ctrl.agentsPerformance);
router.get('/agents/:agentId/audits', ctrl.agentAudits);
router.get('/summary', ctrl.summary);

module.exports = router;
