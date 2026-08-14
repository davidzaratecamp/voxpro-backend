const router = require('express').Router();
const ctrl = require('../controllers/ojt.controller');

router.use(ctrl.requireOjtAccess);

router.get('/aware-sources', ctrl.awareSources);
router.get('/agents', ctrl.list);
router.get('/agents/:id', ctrl.getById);
router.post('/agents', ctrl.requireOjtManage, ctrl.create);
router.patch('/agents/:id', ctrl.requireOjtManage, ctrl.update);

module.exports = router;
