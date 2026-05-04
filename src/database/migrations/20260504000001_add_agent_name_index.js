exports.up = async (knex) => {
  await knex.schema.table('recordings', (t) => {
    // Cubre SELECT DISTINCT agent_id, agent_name — evita full scan + temp table
    t.index(['agent_id', 'agent_name'], 'idx_agent_id_name');
  });

  await knex.schema.table('aware_sources', (t) => {
    t.index(['source_type'], 'idx_source_type');
  });
};

exports.down = async (knex) => {
  await knex.schema.table('recordings', (t) => {
    t.dropIndex(['agent_id', 'agent_name'], 'idx_agent_id_name');
  });

  await knex.schema.table('aware_sources', (t) => {
    t.dropIndex(['source_type'], 'idx_source_type');
  });
};
