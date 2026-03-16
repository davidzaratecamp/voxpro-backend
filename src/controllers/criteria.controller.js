const asyncHandler = require('../middleware/asyncHandler');
const CriteriaService = require('../services/CriteriaService');

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'supervisor_calidad') {
    return res.status(403).json({ error: true, message: 'Se requieren permisos de supervisor de calidad' });
  }
  next();
}

exports.requireAdmin = requireAdmin;

exports.list = asyncHandler(async (req, res) => {
  const data = await CriteriaService.getAll();
  res.json({ data });
});

exports.getOne = asyncHandler(async (req, res) => {
  const data = await CriteriaService.getByKey(req.params.key);
  res.json({ data });
});

exports.update = asyncHandler(async (req, res) => {
  const { key } = req.params;
  const { general_criteria, high_impact_criteria, na_rules, special_instructions } = req.body;

  if (!Array.isArray(general_criteria) || general_criteria.length === 0) {
    return res.status(400).json({ error: true, message: 'general_criteria debe ser un arreglo no vacío' });
  }

  const total = general_criteria.reduce((s, c) => s + (Number(c.weight) || 0), 0);
  if (total !== 100) {
    return res.status(400).json({ error: true, message: `Los pesos suman ${total}, deben ser exactamente 100` });
  }

  const data = await CriteriaService.update(key, {
    generalCriteria:     general_criteria,
    highImpactCriteria:  high_impact_criteria,
    naRules:             na_rules,
    specialInstructions: special_instructions,
    updatedBy:           req.user.id,
  });

  res.json({ message: 'Criterios actualizados', data });
});
