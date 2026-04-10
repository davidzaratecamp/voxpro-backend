const router = require('express').Router();
const ctrl = require('../controllers/hc.controller');

router.use(ctrl.requireSupervisor);

router.get('/overview', ctrl.overview);
router.get('/coordinators', ctrl.listCoordinators);
router.patch('/coordinator/:id/agents', ctrl.updateAgents);
router.delete('/coordinator/:id', ctrl.deleteCoordinator);

module.exports = router;
