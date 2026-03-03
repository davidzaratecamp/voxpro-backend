/**
 * Agrega auditor_id a audit_selections para aislar selecciones por auditor.
 * Permite que múltiples auditores de la misma campaña trabajen de forma independiente.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('audit_selections', (t) => {
    t.integer('auditor_id').unsigned().nullable().references('id').inTable('users').after('client_code');
    t.index(['auditor_id'], 'idx_audit_auditor');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('audit_selections', (t) => {
    t.dropIndex(['auditor_id'], 'idx_audit_auditor');
    t.dropColumn('auditor_id');
  });
};
