/**
 * Agrega columna hangup_by a recordings.
 * Indica quién colgó la llamada: 'caller' (cliente) o 'agent'.
 * Dato obtenido de queue_log en los servidores Aware (schema standard).
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('recordings', (t) => {
    t.string('hangup_by', 10).nullable().comment('Quién colgó: caller o agent');
    t.index(['hangup_by'], 'idx_hangup_by');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('recordings', (t) => {
    t.dropIndex([], 'idx_hangup_by');
    t.dropColumn('hangup_by');
  });
};
