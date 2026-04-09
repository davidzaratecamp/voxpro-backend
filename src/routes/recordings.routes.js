const router = require('express').Router();
const ctrl = require('../controllers/recordings.controller');

router.get('/', ctrl.list);
router.get('/by-agent', ctrl.byAgent);
router.get('/by-agent-phone', ctrl.byAgentPhone);
router.get('/by-phone', ctrl.byPhone);
router.get('/pending', ctrl.getPending);
router.get('/:id', ctrl.getById);
router.patch('/:id/status', ctrl.updateStatus);

module.exports = router;
