/**
 * Trazabilidad de cambios en evaluaciones.
 * - original_criteria/original_score en qa_evaluations: lo que dijo la IA, inmutable.
 * - evaluation_changes: log de cada edición del auditor.
 */

exports.up = async function (knex) {
  // Guardar la evaluación original de la IA (nunca se modifica)
  await knex.schema.alterTable('qa_evaluations', (t) => {
    t.json('original_criteria').nullable().after('criteria');
    t.decimal('original_score', 5, 2).nullable().after('score');
  });

  // Tabla de log de cambios
  await knex.schema.createTable('evaluation_changes', (t) => {
    t.bigIncrements('id').primary();
    t.bigInteger('qa_evaluation_id').unsigned().notNullable();
    t.bigInteger('selection_id').unsigned().notNullable();
    t.integer('user_id').unsigned().notNullable();
    t.string('user_name', 120).notNullable();
    t.json('changes').notNullable().comment('Array de {key, type, label, from, to}');
    t.decimal('score_before', 5, 2).nullable();
    t.decimal('score_after', 5, 2).nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());

    t.foreign('qa_evaluation_id').references('id').inTable('qa_evaluations');
    t.foreign('selection_id').references('id').inTable('audit_selections');
    t.index(['selection_id'], 'idx_eval_changes_selection');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('evaluation_changes');
  await knex.schema.alterTable('qa_evaluations', (t) => {
    t.dropColumn('original_criteria');
    t.dropColumn('original_score');
  });
};
