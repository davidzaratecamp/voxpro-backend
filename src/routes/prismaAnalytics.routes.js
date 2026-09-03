const router = require('express').Router();
const asyncHandler = require('../middleware/asyncHandler');
const SofiaQualityService = require('../services/SofiaQualityService');

/**
 * Endpoint de solo lectura para el panel de analítica de Prisma
 * (rol `analista` — inbound Claro / SOFIA). Devuelve los resultados de
 * auditoría IA que sólo existen en VoxPro: score del bot, oportunidad perdida,
 * score del asesor humano en la continuación y nombres de asesores.
 *
 * Autenticación: token de servicio estático (PRISMA_ANALYTICS_TOKEN), no el
 * JWT de usuario de VoxPro. También lo usa el job que empuja el snapshot.
 */
router.use((req, res, next) => {
  const expected = process.env.PRISMA_ANALYTICS_TOKEN;
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!expected || got !== expected) {
    return res.status(401).json({ error: true, message: 'token de servicio inválido' });
  }
  next();
});

// GET /api/prisma-analytics/sofia-quality?days=30&proyectos=12,13
router.get(
  '/sofia-quality',
  asyncHandler(async (req, res) => {
    res.json(await SofiaQualityService.getQuality({ days: req.query.days, proyectos: req.query.proyectos }));
  }),
);

module.exports = router;
