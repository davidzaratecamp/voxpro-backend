/**
 * Agrega columna agent_ids (JSON) a users.
 * Almacena cédulas (agent_id) en lugar de nombres para un filtro exacto y consistente.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('users', (t) => {
    t.json('agent_ids').nullable().after('agent_names');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('agent_ids');
  });
};
