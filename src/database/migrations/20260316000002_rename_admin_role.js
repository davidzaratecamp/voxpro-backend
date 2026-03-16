/**
 * Renombra el rol 'admin' a 'supervisor_calidad' y agrega 'gestor_usuarios'.
 * - supervisor_calidad: edita matrices de calidad (/configuracion)
 * - gestor_usuarios:    crea y administra usuarios (/usuarios)
 */
exports.up = async function (knex) {
  // 1. Ampliar el ENUM para que acepte ambos valores temporalmente
  await knex.raw(
    "ALTER TABLE users MODIFY COLUMN role ENUM('auditor_obama','auditor_claro','auditor_lv','coordinator_obama','admin','supervisor_calidad','gestor_usuarios') NOT NULL"
  );

  // 2. Migrar datos existentes
  await knex('users').where('role', 'admin').update({ role: 'supervisor_calidad' });

  // 3. Dejar el ENUM limpio (sin 'admin')
  await knex.raw(
    "ALTER TABLE users MODIFY COLUMN role ENUM('auditor_obama','auditor_claro','auditor_lv','coordinator_obama','supervisor_calidad','gestor_usuarios') NOT NULL"
  );
};

exports.down = async function (knex) {
  await knex.raw(
    "ALTER TABLE users MODIFY COLUMN role ENUM('auditor_obama','auditor_claro','auditor_lv','coordinator_obama','admin','supervisor_calidad','gestor_usuarios') NOT NULL"
  );
  await knex('users').where('role', 'supervisor_calidad').update({ role: 'admin' });
  await knex.raw(
    "ALTER TABLE users MODIFY COLUMN role ENUM('auditor_obama','auditor_claro','auditor_lv','coordinator_obama','admin') NOT NULL"
  );
};
