const db = require('../database/connection');

/**
 * Cédulas de agentes OJT activos dentro de un conjunto de client_codes.
 * Usado para el filtro "Solo OJT" que pueden aplicar supervisor_calidad/gestor_usuarios.
 */
async function getActiveOjtCedulas(clientCodes) {
  if (!clientCodes || clientCodes.length === 0) return [];
  const rows = await db('ojt_agents')
    .where('status', 'activo')
    .whereIn('client_code', clientCodes)
    .select('cedula');
  return rows.map((r) => r.cedula);
}

/**
 * Devuelve los agent_ids (cédulas) que el usuario puede ver,
 * o null si no tiene restricción (supervisor ve todo).
 *
 * - coordinator: agent_ids del campo JSON en users
 * - formador: cédulas de sus OJT agents activos
 * - otros (supervisor): null → sin filtro, salvo que pidan onlyOjt
 *
 * @param {number} userId
 * @param {{ onlyOjt?: boolean }} [opts] - onlyOjt: recorta a cédulas OJT activas de los client_codes del usuario
 */
async function resolveAgentIds(userId, opts = {}) {
  const { onlyOjt = false } = opts;
  const userRow = await db('users').where('id', userId).select('agent_ids', 'role', 'client_codes').first();
  if (userRow?.role === 'formador') {
    const ojtAgents = await db('ojt_agents')
      .where({ formador_id: userId, status: 'activo' })
      .select('cedula');
    return ojtAgents.length > 0 ? ojtAgents.map((a) => a.cedula) : [];
  }
  if (onlyOjt) {
    const clientCodes = typeof userRow?.client_codes === 'string'
      ? JSON.parse(userRow.client_codes)
      : (userRow?.client_codes || []);
    return getActiveOjtCedulas(clientCodes);
  }
  return userRow?.agent_ids
    ? (typeof userRow.agent_ids === 'string' ? JSON.parse(userRow.agent_ids) : userRow.agent_ids)
    : null;
}

/**
 * Construye un mapa agentId → campaign ('ventas'|'customer') para Obama.
 * Una sola query — usar en operaciones sobre listas de auditorías.
 */
async function buildObamaAgentCampaignMap() {
  const coords = await db('users')
    .where('role', 'coordinator')
    .where('active', 1)
    .whereNotNull('campaign')
    .whereRaw("JSON_CONTAINS(client_codes, '\"obama\"')")
    .select('agent_ids', 'campaign');

  const map = {};
  for (const coord of coords) {
    const ids = typeof coord.agent_ids === 'string'
      ? JSON.parse(coord.agent_ids)
      : (coord.agent_ids || []);
    for (const id of ids) {
      map[String(id)] = coord.campaign;
    }
  }
  return map;
}

/**
 * Devuelve la campaña de un agente Obama consultando la DB.
 * Fallback: 'ventas' si el agente no tiene coordinador asignado.
 */
async function resolveObamaAgentCampaign(agentId) {
  if (!agentId) return 'ventas';
  const map = await buildObamaAgentCampaignMap();
  return map[String(agentId)] || 'ventas';
}

module.exports = { resolveAgentIds, getActiveOjtCedulas, buildObamaAgentCampaignMap, resolveObamaAgentCampaign };
