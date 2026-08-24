/**
 * Tipificación comercial de la continuación humana (nomenclatura_id de
 * registro_llamada + su clasificación en tipo_contacto): UP=venta,
 * UN=contacto sin venta, VLL/FER/etc=contacto no efectivo, resto=sin
 * contacto. Base para "Análisis Sofia" (funnel, ranking de agentes,
 * motivos de no-venta).
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('sofia_continuation_audits', (t) => {
    t.string('nomenclatura_id', 20).nullable();
    t.string('nomenclatura_nombre', 100).nullable();
    t.string('contacto_efectivo', 30).nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('sofia_continuation_audits', (t) => {
    t.dropColumn('nomenclatura_id');
    t.dropColumn('nomenclatura_nombre');
    t.dropColumn('contacto_efectivo');
  });
};
