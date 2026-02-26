const router = require('express').Router();
const ctrl = require('../controllers/clients.controller');

router.get('/', ctrl.list);
router.get('/sources', ctrl.getSources);
router.get('/:id', ctrl.getById);

module.exports = router;
