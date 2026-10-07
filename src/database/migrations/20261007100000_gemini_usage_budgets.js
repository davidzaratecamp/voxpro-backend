/**
 * Consumo de Gemini por campaña (oct-2026): Claro Hogar y Claro TyT pagan
 * Gemini con presupuestos distintos (ver config/geminiBilling.js).
 *
 *  - gemini_usage: una fila por respuesta de Gemini, con los tokens reales
 *    (texto / audio / salida) y su costo en USD. Es la base para saber cuánto
 *    lleva gastado cada campaña — antes no se guardaba nada.
 *  - gemini_budgets: presupuesto vigente de cada grupo (en COP, desde una
 *    fecha), editable desde la pantalla "Consumo IA". Arranca con la recarga
 *    del 6-oct-2026: 1.000.000 COP para Hogar y 1.000.000 COP para TyT.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('gemini_usage'))) {
    await knex.schema.createTable('gemini_usage', (t) => {
      t.bigIncrements('id').primary();
      t.string('billing_group', 20).notNullable();
      t.string('campaign', 40).nullable();
      t.string('flow', 30).notNullable();
      t.string('model', 60).notNullable();
      t.integer('text_tokens').unsigned().notNullable().defaultTo(0);
      t.integer('audio_tokens').unsigned().notNullable().defaultTo(0);
      t.integer('output_tokens').unsigned().notNullable().defaultTo(0);
      t.decimal('cost_usd', 12, 6).notNullable().defaultTo(0);
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.index(['billing_group', 'created_at']);
    });
  }

  if (!(await knex.schema.hasTable('gemini_budgets'))) {
    await knex.schema.createTable('gemini_budgets', (t) => {
      t.string('billing_group', 20).primary();
      t.decimal('budget_cop', 14, 2).notNullable();
      t.date('start_date').notNullable();
      t.decimal('cop_per_usd', 10, 2).notNullable().defaultTo(4000);
      t.integer('alert_percent').unsigned().notNullable().defaultTo(80);
      t.integer('updated_by').unsigned().nullable();
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
    await knex('gemini_budgets').insert([
      { billing_group: 'hogar', budget_cop: 1000000, start_date: '2026-10-06' },
      { billing_group: 'tyt', budget_cop: 1000000, start_date: '2026-10-06' },
    ]);
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('gemini_budgets');
  await knex.schema.dropTableIfExists('gemini_usage');
};
