const router = require('express').Router();
const ctrl = require('../controllers/santi.controller');

// Auditoría outbound masiva por lista de teléfonos ("Santiago") — solo
// supervisor_calidad, y solo para Claro Hogar (única campaña soportada hoy).
router.use((req, res, next) => {
  if (req.user?.role !== 'supervisor_calidad' || !req.user?.client_codes?.includes('claro_hogar')) {
    return res.status(403).json({ error: true, message: 'Acceso restringido' });
  }
  next();
});

router.post('/import', ctrl.upload.single('file'), ctrl.importExcel);
router.get('/summary', ctrl.getSummary);
router.get('/audits', ctrl.list);
router.get('/export', ctrl.exportRows);
router.post('/process', ctrl.process);

module.exports = router;
