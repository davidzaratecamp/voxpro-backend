/**
 * Cursor real de avance para el runner de auditoría automática. Antes se
 * volvía a pedir siempre "las N llamadas más viejas desde que se activó",
 * así que en cuanto ese bloque quedaba auditado, cada corrida repetía la
 * misma consulta, la filtraba entera, y se quedaba sin nada que hacer —
 * para siempre (pasó dos veces en producción, con ventanas de 20 y de 300).
 * last_scanned_at guarda hasta dónde ya se recorrió la fuente, avanzando
 * en cada corrida sin importar si esas llamadas ya estaban auditadas.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('voicebot_audit_settings', (t) => {
    t.timestamp('last_scanned_at').nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('voicebot_audit_settings', (t) => {
    t.dropColumn('last_scanned_at');
  });
};
