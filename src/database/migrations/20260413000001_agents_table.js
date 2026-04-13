/**
 * Tabla maestra de agentes para Obama.
 * Vincula cédula (Aware) con extensión (Zoom) bajo una identidad unificada.
 */
exports.up = async (knex) => {
  await knex.schema.createTable('agents', (table) => {
    table.increments('id').primary();
    table.string('name', 255).notNullable();
    table.string('cedula', 50).nullable();
    table.string('zoom_extension', 20).nullable();
    table.string('zoom_user_id', 100).nullable();
    table.integer('client_id').unsigned().nullable().references('id').inTable('clients');
    table.boolean('active').notNullable().defaultTo(true);
    table.timestamps(true, true);

    table.index('cedula');
    table.index('zoom_extension');
    table.index('client_id');
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('agents');
};
