/**
 * Permite múltiples selecciones por agente por semana (necesario para LV).
 * Reemplaza unique(agent_id, week_start) por unique(recording_id).
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('audit_selections', (t) => {
    t.dropUnique(['agent_id', 'week_start'], 'uq_agent_week');
    t.unique(['recording_id'], { indexName: 'uq_recording' });
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('audit_selections', (t) => {
    t.dropUnique(['recording_id'], 'uq_recording');
    t.unique(['agent_id', 'week_start'], { indexName: 'uq_agent_week' });
  });
};
