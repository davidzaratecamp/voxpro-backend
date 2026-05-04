exports.up = async (knex) => {
  const recIndexes = await knex.raw("SHOW INDEX FROM recordings WHERE Key_name = 'idx_agent_id_name'");
  if (recIndexes[0].length === 0) {
    await knex.schema.table('recordings', (t) => {
      t.index(['agent_id', 'agent_name'], 'idx_agent_id_name');
    });
  }

  const srcIndexes = await knex.raw("SHOW INDEX FROM aware_sources WHERE Key_name = 'idx_source_type'");
  if (srcIndexes[0].length === 0) {
    await knex.schema.table('aware_sources', (t) => {
      t.index(['source_type'], 'idx_source_type');
    });
  }
};

exports.down = async (knex) => {
  await knex.schema.table('recordings', (t) => {
    t.dropIndex(['agent_id', 'agent_name'], 'idx_agent_id_name');
  });

  await knex.schema.table('aware_sources', (t) => {
    t.dropIndex(['source_type'], 'idx_source_type');
  });
};
