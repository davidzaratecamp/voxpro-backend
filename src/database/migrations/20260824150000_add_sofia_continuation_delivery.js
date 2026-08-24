/**
 * Registro de entrega del feedback: qué coordinador descargó el PDF de
 * feedback para un agente y cuándo — base del ítem de sidebar "Feedback"
 * ("los feedback que han hecho con sus agentes").
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('sofia_continuation_audits', (t) => {
    t.integer('delivered_by').unsigned().nullable();
    t.timestamp('delivered_at').nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('sofia_continuation_audits', (t) => {
    t.dropColumn('delivered_by');
    t.dropColumn('delivered_at');
  });
};
