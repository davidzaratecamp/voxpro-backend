/**
 * Agrega columna campaign a users para identificar a qué campaña
 * pertenece un coordinador (ventas, customer, etc.).
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('users', (table) => {
    table.string('campaign', 50).nullable().after('client_codes');
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('campaign');
  });
};
