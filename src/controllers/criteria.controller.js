const asyncHandler = require('../middleware/asyncHandler');
const CriteriaService = require('../services/CriteriaService');

// auditor_obama_vital alimenta sus propias matrices, pero solo las de su grupo.
const SCOPED_GROUPS = {
  auditor_obama_vital: 'obama_vital',
};

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'supervisor_calidad' && !SCOPED_GROUPS[req.user?.role]) {
    return res.status(403).json({ error: true, message: 'Se requieren permisos de supervisor de calidad' });
  }
  next();
}

/** Lanza 403 si el rol está acotado a un grupo y la matriz es de otro. */
function assertGroupAccess(req, criteria) {
  const group = SCOPED_GROUPS[req.user?.role];
  if (group && criteria.clientGroup !== group) {
    const err = new Error('Sin acceso a esta matriz');
    err.statusCode = 403;
    throw err;
  }
}

exports.requireAdmin = requireAdmin;

exports.list = asyncHandler(async (req, res) => {
  const group = SCOPED_GROUPS[req.user?.role];
  const all = await CriteriaService.getAll();
  const data = group ? all.filter((c) => c.clientGroup === group) : all;
  res.json({ data });
});

exports.getOne = asyncHandler(async (req, res) => {
  const data = await CriteriaService.getByKey(req.params.key);
  assertGroupAccess(req, data);
  res.json({ data });
});

exports.update = asyncHandler(async (req, res) => {
  const { key } = req.params;
  assertGroupAccess(req, await CriteriaService.getByKey(key));
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
