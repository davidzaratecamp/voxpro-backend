const CLIENT_CODES = ['claro_hogar', 'claro_tyt'];

/**
 * client_codes a los que un usuario tiene acceso en el módulo "Sofia IA"
 * (llamadas humanas transferidas por el bot), derivado de sus client_codes —
 * mismo mecanismo que voicebotAccess.js para el módulo del bot.
 *
 * @returns {string[]|null} lista de client_code permitidos, o null = sin
 *   restricción (gestor_usuarios ve ambas campañas).
 */
function resolveAllowedClientCodes(user) {
  if (user?.role === 'gestor_usuarios') return null;
  const codes = user?.client_codes || [];
  return CLIENT_CODES.filter((c) => codes.includes(c));
}

module.exports = { resolveAllowedClientCodes, CLIENT_CODES };
