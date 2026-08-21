exports.up = async function (knex) {
  await knex.schema.alterTable('sofia_human_selections', (t) => {
    t.text('transcription').nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('sofia_human_selections', (t) => {
    t.dropColumn('transcription');
  });
};
