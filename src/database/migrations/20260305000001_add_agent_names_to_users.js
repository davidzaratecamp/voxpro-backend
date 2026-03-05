/**
 * Agrega columna agent_names (JSON) a users.
 * Permite restringir a cada coordinador a solo sus agentes asignados.
 * NULL = sin restricción (ve todos los agentes del cliente).
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('users', (t) => {
    t.json('agent_names').nullable().after('client_codes');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('agent_names');
  });
};
