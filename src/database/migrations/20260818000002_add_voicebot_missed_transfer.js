/**
 * Detecta llamadas donde el cliente mostró intención clara de hablar con un
 * asesor humano (o interés que ameritaba transferencia según el prompt del
 * bot), pero la llamada no terminó transferida — una oportunidad perdida.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('voicebot_call_audits', (t) => {
    t.boolean('missed_transfer').notNullable().defaultTo(false);
    t.text('missed_transfer_reason').nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('voicebot_call_audits', (t) => {
    t.dropColumn('missed_transfer');
    t.dropColumn('missed_transfer_reason');
  });
};
