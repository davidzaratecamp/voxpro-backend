/**
 * Agrega columnas de agente a la tabla recordings.
 * Datos obtenidos de las bases PostgreSQL de cada servidor Aware.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('recordings', (t) => {
    t.string('agent_id', 20).nullable().comment('Cédula del agente');
    t.string('agent_name', 120).nullable();
    t.string('agent_extension', 10).nullable();
    t.integer('call_duration').unsigned().nullable().comment('Duración en segundos (del CDR)');
    t.boolean('agent_enriched').defaultTo(false).comment('Si ya se consultó el Aware DB');

    t.index(['agent_id'], 'idx_agent_id');
    t.index(['agent_enriched'], 'idx_agent_enriched');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('recordings', (t) => {
    t.dropIndex([], 'idx_agent_id');
    t.dropIndex([], 'idx_agent_enriched');
    t.dropColumn('agent_id');
    t.dropColumn('agent_name');
    t.dropColumn('agent_extension');
    t.dropColumn('call_duration');
    t.dropColumn('agent_enriched');
  });
};
