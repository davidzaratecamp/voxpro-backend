/**
 * Módulo OJT (On-the-Job Training):
 * 1. Agrega rol 'formador' al ENUM de users.role
 * 2. Crea tabla ojt_agents para registro dinámico de aprendices por formador
 */

exports.up = async function (knex) {
  // 1. Agregar rol formador
  await knex.raw(
    "ALTER TABLE users MODIFY COLUMN role ENUM('coordinator','formador','auditor_obama','auditor_claro','auditor_lv','auditor_reclutamiento','coordinator_obama','coordinator_reclutamiento','supervisor_calidad','gestor_usuarios') NOT NULL"
  );

  // 2. Crear tabla ojt_agents
  await knex.schema.createTable('ojt_agents', (t) => {
    t.increments('id').primary();

    // Formador responsable del agente
    t.integer('formador_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('RESTRICT');

    // Datos del agente OJT
    t.string('nombre_completo', 150).notNullable();
    t.string('cedula', 30).notNullable();

    // Servidor Aware donde van a caer sus grabaciones
    t.integer('aware_source_id').unsigned().nullable()
      .references('id').inTable('aware_sources').onDelete('SET NULL');

    // Campaña/cliente al que pertenece (obama, claro_tyt, claro_hogar, claro_wcb, lv)
    t.string('client_code', 50).notNullable();

    // Estado del agente en OJT
    t.enum('status', ['activo', 'graduado', 'inactivo']).notNullable().defaultTo('activo');

    t.date('fecha_ingreso').notNullable();
    t.date('fecha_graduacion').nullable();

    t.text('notas').nullable();

    t.timestamps(true, true);

    // Un agente (cédula) no puede estar activo dos veces con el mismo formador
    t.unique(['cedula', 'formador_id', 'status']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('ojt_agents');

  await knex.raw(
    "ALTER TABLE users MODIFY COLUMN role ENUM('coordinator','auditor_obama','auditor_claro','auditor_lv','auditor_reclutamiento','coordinator_obama','coordinator_reclutamiento','supervisor_calidad','gestor_usuarios') NOT NULL"
  );
};
