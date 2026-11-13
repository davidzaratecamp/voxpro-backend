const router = require('express').Router();
const asyncHandler = require('../middleware/asyncHandler');
const { obtenerAgentesActivos } = require('../services/AwareAgentesService');

/**
 * Endpoint de solo lectura para el Gestor Técnico: usuarios activos de cada servidor Aware
 * (cédula, nombre, rol), que el Gestor cruza con sus empleados en la pestaña "Empleados activos"
 * del técnico de inventario. El Gestor no alcanza la red de Aware; VoxPro sí (túnel por Kraken).
 *
 * Autenticación: token de servicio estático (GESTOR_AWARE_TOKEN), no el JWT de usuario de VoxPro.
 * Sin la variable en el .env el endpoint responde 401 a todo.
 */
router.use((req, res, next) => {
  const expected = process.env.GESTOR_AWARE_TOKEN;
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!expected || got !== expected) {
    return res.status(401).json({ error: true, message: 'token de servicio inválido' });
  }
  next();
});

// GET /api/gestor/aware-agentes           → caché de 10 min
// GET /api/gestor/aware-agentes?refrescar=1 → consulta de nuevo los servidores Aware
router.get(
  '/aware-agentes',
  asyncHandler(async (req, res) => {
    res.json(await obtenerAgentesActivos({ refrescar: req.query.refrescar === '1' }));
  }),
);

module.exports = router;
