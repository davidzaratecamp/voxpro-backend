/**
 * Permiso para monitorear el feedback que los auditores entregan a los
 * agentes (pantalla "Seguimiento de feedback"): quién entregó, cuántos y a
 * quién. Es independiente del rol — se le da a una persona puntual (ej. un
 * coordinador de calidad) sin volverla gestor_usuarios.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('users', (t) => {
    t.boolean('feedback_monitor').notNullable().defaultTo(false);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('feedback_monitor');
  });
};
