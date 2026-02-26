const router = require('express').Router();
const auth = require('../middleware/auth');

router.use('/auth', require('./auth.routes'));
router.use('/recordings', auth, require('./recordings.routes'));
router.use('/clients', auth, require('./clients.routes'));
router.use('/stats', auth, require('./stats.routes'));
router.use('/scan', auth, require('./scan.routes'));
router.use('/audit', auth, require('./audit.routes'));
router.use('/reports', auth, require('./reports.routes'));

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
