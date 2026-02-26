/**
 * Tabla audit_selections: selecciones semanales de grabaciones para auditoría.
 * Una llamada por agente por semana (~80 selecciones semanales).
 */

exports.up = async function (knex) {
  await knex.schema.createTable('audit_selections', (t) => {
    t.bigIncrements('id').primary();
    t.bigInteger('recording_id').unsigned().notNullable();
    t.string('agent_id', 20).notNullable();
    t.string('agent_name', 120).nullable();
    t.string('client_code', 50).nullable();
    t.date('week_start').notNullable().comment('Lunes de la semana');
    t.date('week_end').notNullable().comment('Domingo de la semana');
    t.enum('status', ['selected', 'in_review', 'completed', 'skipped']).defaultTo('selected');
    t.integer('score').unsigned().nullable().comment('Puntuación 0-100');
    t.text('notes').nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());

    t.foreign('recording_id').references('id').inTable('recordings');
    t.unique(['agent_id', 'week_start'], { indexName: 'uq_agent_week' });
    t.index(['week_start'], 'idx_audit_week_start');
    t.index(['status'], 'idx_audit_status');
    t.index(['client_code'], 'idx_audit_client');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('audit_selections');
};
