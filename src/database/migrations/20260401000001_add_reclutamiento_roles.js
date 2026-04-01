/**
 * Agrega los roles para el cliente Reclutamiento:
 * - auditor_reclutamiento: auditor que revisa las llamadas
 * - coordinator_reclutamiento: coordinador que ve a sus reclutadoras
 */

exports.up = async function (knex) {
  await knex.raw(
    "ALTER TABLE users MODIFY COLUMN role ENUM('auditor_obama','auditor_claro','auditor_lv','auditor_reclutamiento','coordinator_obama','coordinator_reclutamiento','supervisor_calidad','gestor_usuarios') NOT NULL"
  );
};

exports.down = async function (knex) {
  await knex.raw(
    "ALTER TABLE users MODIFY COLUMN role ENUM('auditor_obama','auditor_claro','auditor_lv','coordinator_obama','supervisor_calidad','gestor_usuarios') NOT NULL"
  );
};
