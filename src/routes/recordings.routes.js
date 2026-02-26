const router = require('express').Router();
const ctrl = require('../controllers/recordings.controller');

router.get('/', ctrl.list);
router.get('/pending', ctrl.getPending);
router.get('/:id', ctrl.getById);
router.patch('/:id/status', ctrl.updateStatus);

module.exports = router;
