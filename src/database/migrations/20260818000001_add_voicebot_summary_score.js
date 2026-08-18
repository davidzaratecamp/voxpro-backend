/**
 * Segundo puntaje independiente en voicebot_call_audits: qué tan coherente
 * es el resumen que la IA le da al agente humano al transferir la llamada,
 * respecto a lo que realmente ocurrió en la conversación con el cliente.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('voicebot_call_audits', (t) => {
    t.integer('summary_score').nullable();
    t.text('summary_issues').nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('voicebot_call_audits', (t) => {
    t.dropColumn('summary_score');
    t.dropColumn('summary_issues');
  });
};
