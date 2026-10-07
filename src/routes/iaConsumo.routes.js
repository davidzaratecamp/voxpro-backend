const router = require('express').Router();
const asyncHandler = require('../middleware/asyncHandler');
const GeminiUsageService = require('../services/GeminiUsageService');

// Consumo de Gemini por campaña y presupuestos — solo administración.
router.use((req, res, next) => {
  if (req.user?.role !== 'gestor_usuarios') {
    return res.status(403).json({ error: true, message: 'Acceso restringido' });
  }
  next();
});

// GET /api/ia-consumo
router.get('/', asyncHandler(async (req, res) => {
  res.json({ data: await GeminiUsageService.summary() });
}));

// PUT /api/ia-consumo/:group { budget_cop, start_date, cop_per_usd, alert_percent }
router.put('/:group', asyncHandler(async (req, res) => {
  const budget = Number(req.body.budget_cop);
  const rate = Number(req.body.cop_per_usd);
  const alert = Number(req.body.alert_percent ?? 80);
  const start = String(req.body.start_date || '');
  if (!(budget > 0) || !(rate > 0) || !(alert >= 1 && alert <= 100) || !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return res.status(400).json({ error: true, message: 'Datos inválidos: presupuesto y tasa deben ser positivos, alerta entre 1 y 100, fecha AAAA-MM-DD' });
  }
  await GeminiUsageService.updateBudget(req.params.group, { budget_cop: budget, start_date: start, cop_per_usd: rate, alert_percent: Math.round(alert) }, req.user.id);
  res.json({ message: 'Presupuesto actualizado' });
}));

module.exports = router;
