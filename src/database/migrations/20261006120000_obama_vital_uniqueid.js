/**
 * Obama Vital ahora lista las llamadas desde el CDR de la central (cdr_custom),
 * no solo desde registro_llamada: Aware deja en registro_llamada un único
 * registro por contacto (el último intento) y los intentos anteriores — muchos
 * contestados y grabados, algunos de más de una hora — solo existen en el CDR.
 * Esas llamadas no tienen registro_llamada_id, así que cada auditoría pasa a
 * identificarse por el `uniqueid` de la central. Las auditorías existentes
 * conservan su registro_llamada_id; su uniqueid se completa la próxima vez que
 * se abran desde la lista (ver ObamaVitalService.selectOne).
 */

exports.up = async function (knex) {
  const hasCol = await knex.schema.hasColumn('obama_vital_audits', 'uniqueid');
  if (!hasCol) {
    await knex.schema.alterTable('obama_vital_audits', (t) => {
      t.string('uniqueid', 40).nullable().unique().after('id');
    });
  }
  await knex.schema.alterTable('obama_vital_audits', (t) => {
    t.integer('registro_llamada_id').nullable().alter();
  });
};

exports.down = async function (knex) {
  // Las auditorías de llamadas no registradas (sin registro_llamada_id) no
  // caben en el esquema anterior: hay que borrarlas antes de revertir.
  await knex.schema.alterTable('obama_vital_audits', (t) => {
    t.dropUnique(['uniqueid']);
    t.dropColumn('uniqueid');
    t.integer('registro_llamada_id').notNullable().alter();
  });
};
