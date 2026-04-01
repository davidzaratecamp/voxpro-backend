/**
 * Elimina el rol coordinator_reclutamiento.
 * Nathali y Leidy pasan a ser auditor_reclutamiento (sin agent_ids = ven todo).
 */

exports.up = async function (knex) {
  // Migrar usuarios con rol coordinator_reclutamiento → auditor_reclutamiento
  await knex('users').where('role', 'coordinator_reclutamiento').update({ role: 'auditor_reclutamiento' });
  await knex.raw(
    "ALTER TABLE users MODIFY COLUMN role ENUM('coordinator','auditor_obama','auditor_claro','auditor_lv','auditor_reclutamiento','coordinator_obama','supervisor_calidad','gestor_usuarios') NOT NULL"
  );
};

exports.down = async function (knex) {
  await knex.raw(
    "ALTER TABLE users MODIFY COLUMN role ENUM('coordinator','auditor_obama','auditor_claro','auditor_lv','auditor_reclutamiento','coordinator_obama','coordinator_reclutamiento','supervisor_calidad','gestor_usuarios') NOT NULL"
  );
};
