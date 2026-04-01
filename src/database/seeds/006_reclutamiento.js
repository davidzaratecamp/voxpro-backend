/**
 * Crea los usuarios del cliente Reclutamiento:
 * - reclutamiento_quality: auditor general (ve todo)
 * - nathali_lopez: supervisora (ve todo, sin agent_ids)
 * - leidy_lara: supervisora (ve todo, sin agent_ids)
 *
 * Las supervisoras tienen agent_ids = null → ven todas las reclutadoras del cliente.
 */
const bcrypt = require('bcrypt');

const SUPERVISORS = [
  { username: 'nathali_lopez', name: 'Lopez Pulido Nathali' },
  { username: 'leidy_lara',    name: 'Lara Leidy Carolina' },
];

exports.seed = async function (knex) {
  const hash = await bcrypt.hash('password', 10);

  // Supervisoras — sin agent_ids para que vean todas las reclutadoras
  for (const sup of SUPERVISORS) {
    const exists = await knex('users').where('username', sup.username).first();
    if (!exists) {
      await knex('users').insert({
        username: sup.username,
        password_hash: hash,
        name: sup.name,
        role: 'auditor_reclutamiento',
        client_codes: JSON.stringify(['reclutamiento']),
        agent_ids: null,
        agent_names: null,
        active: true,
      });
      console.log(`✓ Creado: ${sup.name} (supervisora)`);
    } else {
      await knex('users').where('username', sup.username).update({
        role: 'auditor_reclutamiento',
        client_codes: JSON.stringify(['reclutamiento']),
        agent_ids: null,
        agent_names: null,
      });
      console.log(`✓ Actualizado: ${sup.name} (supervisora)`);
    }
  }
};
