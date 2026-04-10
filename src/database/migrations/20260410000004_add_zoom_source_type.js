/**
 * Agrega source_type a aware_sources para distinguir Aware vs Zoom.
 * Inserta la fuente ZOOM_PHONE para Obama.
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('aware_sources', (table) => {
    table.string('source_type', 20).notNullable().defaultTo('aware').after('active');
  });

  // Insertar fuente Zoom para Obama (client_id = 1)
  const obamaClient = await knex('clients').where('code', 'obama').select('id').first();
  if (obamaClient) {
    await knex('aware_sources').insert({
      client_id: obamaClient.id,
      folder_name: 'ZOOM_PHONE',
      source_type: 'zoom',
      active: true,
    });
  }
};

exports.down = async (knex) => {
  await knex('aware_sources').where('folder_name', 'ZOOM_PHONE').delete();
  await knex.schema.alterTable('aware_sources', (table) => {
    table.dropColumn('source_type');
  });
};
