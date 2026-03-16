const router = require('express').Router();
const ctrl = require('../controllers/users.controller');

router.use(ctrl.requireGestor);

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);
router.patch('/:id/active', ctrl.toggleActive);

module.exports = router;
