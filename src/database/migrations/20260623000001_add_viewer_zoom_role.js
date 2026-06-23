exports.up = async (knex) => {
  await knex.raw(`
    ALTER TABLE users MODIFY COLUMN role
    ENUM(
      'coordinator','formador',
      'auditor_obama','auditor_claro','auditor_lv','auditor_reclutamiento',
      'coordinator_obama','coordinator_reclutamiento',
      'supervisor_calidad','viewer_zoom',
      'gestor_usuarios','coordinador_avaya'
    ) NOT NULL
  `);
};

exports.down = async (knex) => {
  await knex.raw(`
    ALTER TABLE users MODIFY COLUMN role
    ENUM(
      'coordinator','formador',
      'auditor_obama','auditor_claro','auditor_lv','auditor_reclutamiento',
      'coordinator_obama','coordinator_reclutamiento',
      'supervisor_calidad',
      'gestor_usuarios','coordinador_avaya'
    ) NOT NULL
  `);
};
