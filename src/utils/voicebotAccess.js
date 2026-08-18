const voicebotSource = require('../config/voicebotSource');

/**
 * Proyectos (campañas) a los que un usuario tiene acceso en el módulo de
 * Auditoría IA, derivado de sus client_codes — mismo mecanismo que usa el
 * resto de VoxPro para aislar por campaña.
 *
 * @returns {number[]|null} lista de proyecto_id permitidos, o null = sin
 *   restricción (gestor_usuarios ve todo).
 */
function resolveAllowedProyectos(user) {
  if (user?.role === 'gestor_usuarios') return null;
  const codes = user?.client_codes || [];
  return codes.map((c) => voicebotSource.clientCodeToProyecto[c]).filter(Boolean);
}

module.exports = { resolveAllowedProyectos };
