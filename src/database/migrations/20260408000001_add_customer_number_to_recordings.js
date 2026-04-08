exports.up = (knex) =>
  knex.schema.alterTable('recordings', (t) => {
    t.string('customer_number', 50).nullable().after('agent_name');
  });

exports.down = (knex) =>
  knex.schema.alterTable('recordings', (t) => {
    t.dropColumn('customer_number');
  });
