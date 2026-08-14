/**
 * Agrega el rol 'auditor_ia' al ENUM de users.role.
 * Usuarios con este rol auditan las llamadas de los agentes de IA (voicebot)
 * de Claro, consultadas en vivo desde asiste.awareccm.com (ver VoicebotService).
 * No requiere tablas nuevas: los datos viven enteramente en la fuente externa.
 */

exports.up = async function (knex) {
  await knex.raw(
    "ALTER TABLE users MODIFY COLUMN role ENUM('coordinator','formador','auditor_obama','auditor_claro','auditor_lv','auditor_reclutamiento','coordinator_obama','coordinator_reclutamiento','supervisor_calidad','viewer_zoom','gestor_usuarios','coordinador_avaya','auditor_ia') NOT NULL"
  );
};

exports.down = async function (knex) {
  await knex.raw(
    "ALTER TABLE users MODIFY COLUMN role ENUM('coordinator','formador','auditor_obama','auditor_claro','auditor_lv','auditor_reclutamiento','coordinator_obama','coordinator_reclutamiento','supervisor_calidad','viewer_zoom','gestor_usuarios','coordinador_avaya') NOT NULL"
  );
};
