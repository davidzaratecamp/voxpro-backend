/**
 * Obama Vital: matriz de Ventas (proyectos 12 Ventas 1, 13 Ventas 2 y 19
 * Nuevos Estados, ver config/obamaVitalSource.js). Arranca como copia de
 * obama_ventas —igual que Bienvenida— para que el auditor la ajuste desde
 * Configuración.
 */

const KEY = 'obama_vital_ventas';

// mysql2 devuelve las columnas JSON ya parseadas: hay que volver a serializar.
const asJson = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

exports.up = async function (knex) {
  const exists = await knex('criteria_configs').where('campaign_key', KEY).first();
  if (exists) return;

  const source = await knex('criteria_configs').where('campaign_key', 'obama_ventas').first()
    || await knex('criteria_configs').where('campaign_key', 'obama_vital_bienvenida').first();
  if (!source) throw new Error('No existe una matriz de origen (obama_ventas / obama_vital_bienvenida)');

  await knex('criteria_configs').insert({
    campaign_key:         KEY,
    client_group:         'obama_vital',
    campaign_label:       'Obama Vital — Ventas',
    general_criteria:     asJson(source.general_criteria),
    high_impact_criteria: asJson(source.high_impact_criteria),
    na_rules:             asJson(source.na_rules),
    special_instructions: source.special_instructions,
    updated_by:           null,
  });
};

exports.down = async function (knex) {
  await knex('criteria_configs').where('campaign_key', KEY).delete();
};
