/**
 * La fuente de las colas humanas de SOFIA solo trae la cédula del agente
 * (agente_id), no el nombre. Se snapshotea aquí resuelto desde `recordings`
 * (mismos agentes de Claro Hogar/TyT, ya tienen nombre ahí por el escaneo
 * estándar).
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('sofia_human_selections', (t) => {
    t.string('agente_nombre', 150).nullable().after('agente_id');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('sofia_human_selections', (t) => {
    t.dropColumn('agente_nombre');
  });
};
