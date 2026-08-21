/**
 * Selecciones de auditoría para las llamadas humanas que SOFIA transfiere.
 * Mismo mecanismo que audit_selections (un agente, una vez por semana —
 * select-one/AuditDetail), pero en tabla propia: audit_selections tiene
 * UNIQUE(agent_id, week_start) GLOBAL, y estas llamadas viven en una fuente
 * distinta (registro_llamada de asiste.awareccm.com, proyectos 7/9=Inb
 * Hogar IA, 10/11=Inb T&T IA) — no pueden compartir esa llave con las
 * selecciones orgánicas sin bloquearse entre sí.
 *
 * Los campos de la llamada (telefono/fecha/hora/duracion/audiofile) se
 * snapshotean al seleccionar, porque no se puede hacer JOIN entre esta
 * tabla MySQL y la fuente Postgres externa.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('sofia_human_selections', (t) => {
    t.bigIncrements('id').primary();
    t.integer('registro_llamada_id').notNullable();
    t.integer('proyecto_id').notNullable();
    t.string('client_code', 20).notNullable();
    t.string('agente_id', 20).notNullable();
    t.string('telefono', 20).nullable();
    t.date('fecha').notNullable();
    t.time('hora').nullable();
    t.integer('duracion').unsigned().nullable();
    t.string('audiofile', 300).nullable();
    t.integer('auditor_id').unsigned().nullable().references('id').inTable('users');
    t.date('week_start').notNullable();
    t.date('week_end').notNullable();
    t.enum('status', ['selected', 'in_review', 'completed', 'skipped']).defaultTo('selected');
    t.integer('score').unsigned().nullable();
    t.json('criteria_general').nullable();
    t.json('criteria_high_impact').nullable();
    t.boolean('high_impact_failed').defaultTo(false);
    t.text('notes').nullable();
    t.timestamp('scored_at').nullable();
    t.timestamps(true, true);

    t.unique(['agente_id', 'week_start'], { indexName: 'uq_sofia_agent_week' });
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('sofia_human_selections');
};
