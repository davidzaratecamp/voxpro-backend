/**
 * voicebot_audit_settings pasa de ser una fila única global (id=1) a una
 * fila por campaña (proyecto_id como PK, mismo patrón que voicebot_prompts).
 * Necesario para que cada auditor_ia (asignado por client_codes a una sola
 * campaña) pueda activar/detener su propia auditoría automática sin afectar
 * la del otro. No hay estado importante que preservar — es solo el toggle,
 * los resultados de auditoría siguen intactos en voicebot_call_audits.
 */

exports.up = async function (knex) {
  await knex.schema.dropTableIfExists('voicebot_audit_settings');
  await knex.schema.createTable('voicebot_audit_settings', (t) => {
    t.integer('proyecto_id').primary();
    t.boolean('enabled').notNullable().defaultTo(false);
    t.timestamp('enabled_at').nullable();
    t.integer('enabled_by').unsigned().nullable().references('id').inTable('users');
    t.text('disabled_reason').nullable();
    t.timestamps(true, true);
  });
  await knex('voicebot_audit_settings').insert([
    { proyecto_id: 12, enabled: false },
    { proyecto_id: 13, enabled: false },
  ]);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('voicebot_audit_settings');
  await knex.schema.createTable('voicebot_audit_settings', (t) => {
    t.integer('id').primary();
    t.boolean('enabled').notNullable().defaultTo(false);
    t.timestamp('enabled_at').nullable();
    t.integer('enabled_by').unsigned().nullable().references('id').inTable('users');
    t.text('disabled_reason').nullable();
    t.timestamps(true, true);
  });
  await knex('voicebot_audit_settings').insert({ id: 1, enabled: false });
};
