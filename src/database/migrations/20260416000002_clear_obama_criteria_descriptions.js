/**
 * Limpia el campo `description` de cada ítem en las matrices de Obama
 * (obama_ventas y obama_customer) y borra special_instructions.
 *
 * Objetivo: dejar los ítems solo con key, label y weight para que la
 * supervisora configure las descripciones desde la pantalla de Configuración.
 */

function stripDescriptions(items) {
  return items.map(({ description, ...rest }) => rest);
}

exports.up = async (knex) => {
  for (const key of ['obama_ventas', 'obama_customer']) {
    const row = await knex('criteria_configs').where('campaign_key', key).first();
    if (!row) continue;

    const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

    await knex('criteria_configs').where('campaign_key', key).update({
      general_criteria:     JSON.stringify(stripDescriptions(parse(row.general_criteria))),
      high_impact_criteria: JSON.stringify(stripDescriptions(parse(row.high_impact_criteria))),
      special_instructions: null,
      updated_at:           knex.fn.now(),
    });
  }
};

exports.down = async () => {
  // No se restauran — la supervisora reescribirá las descripciones desde la UI.
};
