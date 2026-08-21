/**
 * Continuación humana de una llamada del bot: la llamada del agente humano
 * que recibió la transferencia, identificada por teléfono+hora y calificada
 * automáticamente con la misma matriz de calidad — cacheada por bot_call_id
 * (no por agente/semana, a diferencia de sofia_human_selections) porque acá
 * se necesita esa continuación exacta, no "la que ya esté seleccionada esa
 * semana para ese agente".
 */

exports.up = async function (knex) {
  await knex.schema.createTable('sofia_continuation_audits', (t) => {
    t.bigIncrements('id').primary();
    t.string('bot_call_id', 60).notNullable().unique();
    t.integer('registro_llamada_id').nullable();
    t.integer('proyecto_id').nullable();
    t.string('client_code', 20).nullable();
    t.string('agente_id', 20).nullable();
    t.string('agente_nombre', 150).nullable();
    t.string('telefono', 20).nullable();
    t.date('fecha').nullable();
    t.time('hora').nullable();
    t.integer('duracion').unsigned().nullable();
    t.string('audiofile', 300).nullable();
    t.text('transcription').nullable();
    t.json('criteria_general').nullable();
    t.json('criteria_high_impact').nullable();
    t.boolean('high_impact_failed').defaultTo(false);
    t.integer('score').unsigned().nullable();
    t.text('notes').nullable();
    t.enum('status', ['not_found', 'pending', 'scored', 'error']).defaultTo('pending');
    t.text('error_message').nullable();
    t.timestamps(true, true);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('sofia_continuation_audits');
};
