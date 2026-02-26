const router = require('express').Router();
const ctrl = require('../controllers/reports.controller');

router.get('/kpis', ctrl.kpis);
router.get('/weekly-trend', ctrl.weeklyTrend);
router.get('/score-by-client', ctrl.scoreByClient);
router.get('/failing-criteria', ctrl.failingCriteria);
router.get('/status-distribution', ctrl.statusDistribution);
router.get('/agent-ranking', ctrl.agentRanking);
router.get('/export-data', ctrl.exportData);

module.exports = router;
