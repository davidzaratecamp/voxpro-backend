exports.up = async function (knex) {
  await knex.schema.createTable('criteria_configs', (t) => {
    t.string('campaign_key', 30).primary();
    t.string('client_group', 20).notNullable();
    t.string('campaign_label', 100).notNullable();
    t.json('general_criteria').notNullable();
    t.json('high_impact_criteria').notNullable();
    t.json('na_rules').notNullable();
    t.text('special_instructions').nullable();
    t.integer('updated_by').unsigned().nullable().references('id').inTable('users');
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('criteria_configs');
};
