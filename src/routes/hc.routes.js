const router = require('express').Router();
const ctrl = require('../controllers/hc.controller');

router.use(ctrl.requireSupervisor);

router.get('/overview', ctrl.overview);
router.patch('/coordinator/:id/agents', ctrl.updateAgents);
router.delete('/coordinator/:id', ctrl.deleteCoordinator);

module.exports = router;
