/**
 * Crea los usuarios coordinadores de Obama (Jorge Patiño y Julissa Diaz).
 * Cada coordinador ve TODOS sus agentes sin importar la campaña.
 * Los agent_ids se toman directamente de segmentacionObama.js (cédulas).
 */
const bcrypt = require('bcrypt');
const segmentacionObama = require('../../../../segmentacion/segmentacionObama');

function getCoordinatorAgents(coordinadorName) {
  const grupos = segmentacionObama.filter((g) => g.coordinador === coordinadorName);
  const agentIds = [];
  const agentNames = [];
  for (const grupo of grupos) {
    for (const agente of grupo.agentes) {
      if (!agentIds.includes(agente.documento)) {
        agentIds.push(agente.documento);
        agentNames.push(agente.nombre);
      }
    }
  }
  return { agentIds, agentNames };
}

exports.seed = async function (knex) {
  const hash = await bcrypt.hash('password', 10);

  const coordinators = [
    {
      username: 'jorge_patino',
      name: 'Jorge Patiño',
      coordinadorKey: 'Jorge Patiño',
    },
    {
      username: 'julissa_diaz',
      name: 'Julissa Diaz',
      coordinadorKey: 'Julissa Diaz',
    },
  ];

  for (const coord of coordinators) {
    const { agentIds, agentNames } = getCoordinatorAgents(coord.coordinadorKey);

    const exists = await knex('users').where('username', coord.username).first();
    if (!exists) {
      await knex('users').insert({
        username: coord.username,
        password_hash: hash,
        name: coord.name,
        role: 'coordinator_obama',
        client_codes: JSON.stringify(['obama']),
        agent_names: JSON.stringify(agentNames),
        agent_ids: JSON.stringify(agentIds),
        active: true,
      });
      console.log(`✓ Creado: ${coord.name} (${agentIds.length} agentes)`);
    } else {
      await knex('users').where('username', coord.username).update({
        agent_names: JSON.stringify(agentNames),
        agent_ids: JSON.stringify(agentIds),
        role: 'coordinator_obama',
        client_codes: JSON.stringify(['obama']),
      });
      console.log(`✓ Actualizado: ${coord.name} (${agentIds.length} agentes)`);
    }

    console.log(`  Agentes: ${agentIds.join(', ')}`);
  }
};
