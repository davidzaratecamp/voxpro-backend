/**
 * Corrige el constraint único de ojt_agents.
 * Antes: UNIQUE(cedula, formador_id, status) — permitía múltiples registros
 *        activos si se insertaban en paralelo (el status era parte de la clave).
 * Ahora: UNIQUE(cedula, formador_id) con un índice parcial a nivel de app,
 *        pero el verdadero control se hace con un CHECK + constraint sin status.
 *
 * Estrategia: reemplazar el constraint por UNIQUE(cedula, formador_id).
 * Esto impide que el mismo agente aparezca dos veces con el mismo formador,
 * independientemente del estado. Si se necesita re-registrar (ej. graduado → activo),
 * se usa el mismo registro actualizando su status.
 */
exports.up = async (knex) => {
  // Eliminar el constraint antiguo que incluía status
  await knex.schema.alterTable('ojt_agents', (table) => {
    table.dropUnique(['cedula', 'formador_id', 'status']);
  });

  // Crear el constraint correcto sin status
  await knex.schema.alterTable('ojt_agents', (table) => {
    table.unique(['cedula', 'formador_id'], { indexName: 'uq_ojt_cedula_formador' });
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('ojt_agents', (table) => {
    table.dropUnique(['cedula', 'formador_id'], { indexName: 'uq_ojt_cedula_formador' });
  });

  await knex.schema.alterTable('ojt_agents', (table) => {
    table.unique(['cedula', 'formador_id', 'status']);
  });
};
