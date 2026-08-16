/**
 * Auditoría automática con IA de las llamadas del voicebot de Claro.
 * - voicebot_prompts: un prompt operativo por proyecto (12=Hogar, 13=TyT),
 *   usado como matriz de calidad para calificar cada llamada.
 * - voicebot_audit_settings: fila única con el switch de auditoría automática
 *   y la fecha desde la que se auditan llamadas nuevas.
 * - voicebot_call_audits: resultado (score + resumen) por llamada.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('voicebot_prompts', (t) => {
    t.integer('proyecto_id').primary();
    t.text('prompt_text', 'longtext').notNullable();
    t.integer('updated_by').unsigned().nullable().references('id').inTable('users');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('voicebot_audit_settings', (t) => {
    t.integer('id').primary();
    t.boolean('enabled').notNullable().defaultTo(false);
    t.timestamp('enabled_at').nullable();
    t.integer('enabled_by').unsigned().nullable().references('id').inTable('users');
    t.timestamps(true, true);
  });
  await knex('voicebot_audit_settings').insert({ id: 1, enabled: false });

  await knex.schema.createTable('voicebot_call_audits', (t) => {
    t.increments('id').primary();
    t.string('call_id', 100).notNullable().unique();
    t.integer('proyecto_id').notNullable();
    t.integer('score').nullable();
    t.text('summary').nullable();
    t.text('strengths').nullable();
    t.text('issues').nullable();
    t.timestamp('analyzed_at').notNullable().defaultTo(knex.fn.now());
    t.timestamps(true, true);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('voicebot_call_audits');
  await knex.schema.dropTableIfExists('voicebot_audit_settings');
  await knex.schema.dropTableIfExists('voicebot_prompts');
};
