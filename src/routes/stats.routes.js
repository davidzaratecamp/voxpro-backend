const router = require('express').Router();
const ctrl = require('../controllers/stats.controller');

router.get('/overview', ctrl.overview);
router.get('/by-client', ctrl.byClient);
router.get('/daily', ctrl.daily);
router.get('/agents', ctrl.agents);
router.get('/jobs', ctrl.jobHistory);

module.exports = router;
