/**
 * Registra por qué se detuvo la auditoría automática cuando el sistema
 * mismo la apaga (ej. se agotó la cuota de tokens de Gemini), para poder
 * avisarle al usuario cuando intente activarla de nuevo.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('voicebot_audit_settings', (t) => {
    t.text('disabled_reason').nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('voicebot_audit_settings', (t) => {
    t.dropColumn('disabled_reason');
  });
};
