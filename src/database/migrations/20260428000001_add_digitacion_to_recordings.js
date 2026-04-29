exports.up = function (knex) {
  return knex.schema.alterTable('recordings', (table) => {
    table.string('digitacion_nomenclatura', 20).nullable();
    table.string('digitacion_nombre', 200).nullable();
    table.text('digitacion_obs').nullable();
    table.string('digitacion_motivo_rechazo', 300).nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('recordings', (table) => {
    table.dropColumn('digitacion_nomenclatura');
    table.dropColumn('digitacion_nombre');
    table.dropColumn('digitacion_obs');
    table.dropColumn('digitacion_motivo_rechazo');
  });
};
