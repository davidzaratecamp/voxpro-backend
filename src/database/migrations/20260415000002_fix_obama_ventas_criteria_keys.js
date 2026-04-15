/**
 * Corrige los criterios de alto impacto de obama_ventas en criteria_configs.
 *
 * Problemas encontrados:
 * 1. Clave duplicada: 'maltrato_cliente' y 'Maltrato_cliente' — el mismo ítem
 *    con distinto casing. Esto hace que Gemini genere índices numéricos (0,1,2...)
 *    en lugar de nombres, rompiendo toda la evaluación (score siempre 0).
 * 2. Claves con mayúsculas inconsistentes: Recapitulacion_venta, Cuelgue_llamada,
 *    Fraude_Comercial, Validacion_requisitos, etc.
 * 3. naRules con los mismos problemas de casing → no hacen match con los criterios.
 *
 * Solución: normalizar TODOS los keys a lowercase_snake_case y eliminar el duplicado.
 */

const KEY_MAP = {
  'solicitud_referidos':        'solicitud_referidos',
  'falta_empatia_cliente':      'falta_empatia_cliente',
  'maltrato_cliente':           'maltrato_cliente',
  'Maltrato_cliente':           null,                        // DUPLICADO → eliminar
  'Dumentacion_y_social':       'documentacion_y_social',
  'Pago_automatico':            'pago_automatico',
  'tipificacion_correcta':      'tipificacion_correcta',
  'oferta_comercial_y_expicacion': 'oferta_comercial_y_explicacion',
  'Doble_oferta_poliza':        'doble_oferta_poliza',
  'Recapitulacion_venta':       'recapitulacion_venta',
  'Validacion_requisitos':      'validacion_requisitos',
  'Cuelgue_llamada':            'cuelgue_llamada',
  'Fraude_Comercial':           'fraude_comercial',
  'Validacion_taxes':           'validacion_taxes',
};

function normalizeKey(key) {
  if (KEY_MAP.hasOwnProperty(key)) return KEY_MAP[key];
  return key.toLowerCase();
}

exports.up = async (knex) => {
  const row = await knex('criteria_configs').where('campaign_key', 'obama_ventas').first();
  if (!row) return;

  const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

  const highImpact = parse(row.high_impact_criteria);
  const naRules    = parse(row.na_rules);

  // 1. Limpiar high_impact: normalizar keys, eliminar duplicados
  const seen = new Set();
  const cleanHighImpact = [];
  for (const item of highImpact) {
    const newKey = normalizeKey(item.key);
    if (newKey === null) continue;      // duplicado marcado para eliminar
    if (seen.has(newKey)) continue;     // duplicado por normalización
    seen.add(newKey);
    cleanHighImpact.push({ ...item, key: newKey });
  }

  // 2. Limpiar naRules: normalizar keys en cada grupo
  const cleanNaRules = {};
  for (const [group, keys] of Object.entries(naRules)) {
    const cleanKeys = [...new Set(
      keys
        .map(normalizeKey)
        .filter((k) => k !== null)
    )];
    cleanNaRules[group] = cleanKeys;
  }

  await knex('criteria_configs').where('campaign_key', 'obama_ventas').update({
    high_impact_criteria: JSON.stringify(cleanHighImpact),
    na_rules:             JSON.stringify(cleanNaRules),
    updated_at:           knex.fn.now(),
  });
};

exports.down = async () => {
  // No se restaura — los datos corruptos no deben volver
};
