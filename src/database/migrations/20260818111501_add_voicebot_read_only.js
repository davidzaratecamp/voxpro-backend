/**
 * Permite marcar una cuenta (ej. una demo/compartida) como de solo lectura
 * en el módulo de Auditoría IA: puede ver llamadas, prompts y el estado de
 * la auditoría automática, pero no editar prompts ni activar/detener el
 * switch de ninguna campaña.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('users', (t) => {
    t.boolean('voicebot_read_only').notNullable().defaultTo(false);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('voicebot_read_only');
  });
};
