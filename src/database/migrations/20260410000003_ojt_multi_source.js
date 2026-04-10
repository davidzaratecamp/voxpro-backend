/**
 * Cambia aware_source_id (int único) por aware_source_ids (JSON array)
 * en ojt_agents, para soportar agentes que trabajan en múltiples servidores Aware.
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('ojt_agents', (table) => {
    table.json('aware_source_ids').nullable().after('cedula');
  });

  // Migrar datos existentes: aware_source_id → aware_source_ids como array de un elemento
  await knex.raw(`
    UPDATE ojt_agents
    SET aware_source_ids = JSON_ARRAY(aware_source_id)
    WHERE aware_source_id IS NOT NULL AND aware_source_ids IS NULL
  `);

  await knex.schema.alterTable('ojt_agents', (table) => {
    table.dropForeign(['aware_source_id']);
    table.dropColumn('aware_source_id');
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('ojt_agents', (table) => {
    table.integer('aware_source_id').unsigned().nullable().references('id').inTable('aware_sources');
  });

  await knex.raw(`
    UPDATE ojt_agents
    SET aware_source_id = JSON_UNQUOTE(JSON_EXTRACT(aware_source_ids, '$[0]'))
    WHERE aware_source_ids IS NOT NULL
  `);

  await knex.schema.alterTable('ojt_agents', (table) => {
    table.dropColumn('aware_source_ids');
  });
};
