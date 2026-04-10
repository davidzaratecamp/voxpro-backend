const router = require('express').Router();
const auth = require('../middleware/auth');

router.use('/auth', require('./auth.routes'));
router.use('/recordings', auth, require('./recordings.routes'));
router.use('/clients', auth, require('./clients.routes'));
router.use('/stats', auth, require('./stats.routes'));
router.use('/scan', auth, require('./scan.routes'));
router.use('/audit', auth, require('./audit.routes'));
router.use('/reports', auth, require('./reports.routes'));
router.use('/criteria', auth, require('./criteria.routes'));
router.use('/users', auth, require('./users.routes'));
router.use('/ojt', auth, require('./ojt.routes'));
router.use('/avaya', auth, require('./avaya.routes'));
router.use('/realtime', auth, require('./realtime.routes'));
router.use('/hc', auth, require('./hc.routes'));

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
