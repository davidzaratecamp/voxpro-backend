/**
 * Agrega columna cedula a users para identificar a coordinadores y otros usuarios.
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('users', (table) => {
    table.string('cedula', 20).nullable().after('name');
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('cedula');
  });
};
