/**
 * Activa AWARE_6 y lo asocia al cliente Reclutamiento.
 * AWARE_6 ya existía en la tabla pero con client_id = 2 (Majority, inactivo).
 */
exports.up = async function (knex) {
  const reclutamiento = await knex('clients').where('code', 'reclutamiento').first('id');
  if (!reclutamiento) throw new Error('Cliente reclutamiento no encontrado en tabla clients');

  await knex('aware_sources')
    .where('folder_name', 'AWARE_6')
    .update({
      client_id: reclutamiento.id,
      active: true,
    });
};

exports.down = async function (knex) {
  const majority = await knex('clients').where('code', 'majority').first('id');
  await knex('aware_sources')
    .where('folder_name', 'AWARE_6')
    .update({
      client_id: majority?.id ?? 2,
      active: false,
    });
};
