/**
 * Módulo Avaya:
 * 1. Agrega rol 'coordinador_avaya' al ENUM de users.role
 * 2. Crea tabla avaya_agents para registro de agentes por coordinador Avaya
 * 3. Inserta fuente Avaya en aware_sources para claro_tyt
 */

exports.up = async function (knex) {
  // 1. Agregar rol coordinador_avaya
  await knex.raw(
    "ALTER TABLE users MODIFY COLUMN role ENUM('coordinator','formador','auditor_obama','auditor_claro','auditor_lv','auditor_reclutamiento','coordinator_obama','coordinator_reclutamiento','supervisor_calidad','gestor_usuarios','coordinador_avaya') NOT NULL"
  );

  // 2. Crear tabla avaya_agents
  await knex.schema.createTable('avaya_agents', (t) => {
    t.increments('id').primary();
    t.integer('coordinator_id').unsigned().notNullable().references('id').inTable('users');
    t.string('nombre_completo', 150).notNullable();
    t.string('cedula', 30).notNullable();
    t.string('client_code', 50).notNullable();
    t.enum('status', ['activo', 'inactivo']).notNullable().defaultTo('activo');
    t.text('notas').nullable();
    t.timestamps(true, true);
  });

  // 3. Insertar fuente Avaya para claro_tyt
  const tytClient = await knex('clients').where('code', 'claro_tyt').select('id').first();
  if (tytClient) {
    const existing = await knex('aware_sources')
      .where({ folder_name: 'AVAYA_CLARO_TYT', client_id: tytClient.id })
      .first();
    if (!existing) {
      await knex('aware_sources').insert({
        client_id: tytClient.id,
        folder_name: 'AVAYA_CLARO_TYT',
        active: true,
      });
    }
  }
};

exports.down = async function (knex) {
  await knex('aware_sources').where('folder_name', 'AVAYA_CLARO_TYT').delete();
  await knex.schema.dropTableIfExists('avaya_agents');
  await knex.raw(
    "ALTER TABLE users MODIFY COLUMN role ENUM('coordinator','formador','auditor_obama','auditor_claro','auditor_lv','auditor_reclutamiento','coordinator_obama','coordinator_reclutamiento','supervisor_calidad','gestor_usuarios') NOT NULL"
  );
};
