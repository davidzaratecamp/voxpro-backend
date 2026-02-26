/**
 * Agrega proyecto_id a recordings para distinguir campañas dentro de un mismo servidor Aware.
 * Ej: AWARE_30 tiene proyectos de Obama (ASISTE ING) y de LV (Luis Vittier/Vital Health).
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('recordings', (t) => {
    t.integer('proyecto_id').unsigned().nullable().comment('ID del proyecto en Aware');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('recordings', (t) => {
    t.dropColumn('proyecto_id');
  });
};
