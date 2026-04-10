const router = require('express').Router();
const ctrl = require('../controllers/hc.controller');

router.use(ctrl.requireSupervisor);

router.get('/overview', ctrl.overview);
router.patch('/coordinator/:id/agents', ctrl.updateAgents);

module.exports = router;
