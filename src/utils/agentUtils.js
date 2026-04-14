const db = require('../database/connection');

/**
 * Devuelve los agent_ids (cédulas) que el usuario puede ver,
 * o null si no tiene restricción (supervisor ve todo).
 *
 * - coordinator: agent_ids del campo JSON en users
 * - formador: cédulas de sus OJT agents activos
 * - otros (supervisor): null → sin filtro
 */
async function resolveAgentIds(userId) {
  const userRow = await db('users').where('id', userId).select('agent_ids', 'role').first();
  if (userRow?.role === 'formador') {
    const ojtAgents = await db('ojt_agents')
      .where({ formador_id: userId, status: 'activo' })
      .select('cedula');
    return ojtAgents.length > 0 ? ojtAgents.map((a) => a.cedula) : [];
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

module.exports = { resolveAgentIds, buildObamaAgentCampaignMap, resolveObamaAgentCampaign };
