const router = require('express').Router();
const ctrl = require('../controllers/criteria.controller');

router.use(ctrl.requireAdmin);

router.get('/', ctrl.list);
router.get('/:key', ctrl.getOne);
router.put('/:key', ctrl.update);

module.exports = router;
