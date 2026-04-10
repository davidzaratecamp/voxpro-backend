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

module.exports = { resolveAgentIds };
