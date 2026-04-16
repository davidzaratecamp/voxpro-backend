const { CRITERIA } = require('../../config/evaluationCriteria');

/**
 * NA rules extracted from GeminiService.js hardcoded arrays.
 * - third_party:  TITULAR_CRITERIA  — criteria requiring the actual account holder
 * - dropped_call: CLOSURE_CRITERIA  — criteria requiring the call to reach its end
 * - rejection:    POST_REJECTION_CRITERIA — criteria requiring client acceptance
 * - always_na:    UNVERIFIABLE      — criteria not auditable from audio
 */
const NA_RULES = {
  claro_wcb: {
    third_party:  ['interes_necesidades', 'oferta_comercial', 'manejo_objeciones', 'cierre_comercial', 'resalta_beneficios'],
    dropped_call: ['cierre_comercial', 'manejo_objeciones', 'despedida', 'tipificacion'],
    rejection:    ['cierre_comercial'],
    always_na:    ['uso_herramientas', 'tipificacion'],
  },
  claro_movil: {
    third_party:  ['interes_necesidades', 'oferta_comercial', 'manejo_objeciones', 'cierre_comercial', 'resalta_beneficios'],
    dropped_call: ['cierre_comercial', 'manejo_objeciones', 'despedida', 'tipificacion'],
    rejection:    ['cierre_comercial'],
    always_na:    ['uso_herramientas', 'tipificacion'],
  },
  claro_pymes: {
    third_party:  ['interes_necesidades', 'oferta_comercial', 'manejo_objeciones', 'cierre_comercial', 'resalta_beneficios'],
    dropped_call: ['cierre_comercial', 'manejo_objeciones', 'despedida', 'tipificacion'],
    rejection:    ['cierre_comercial'],
    always_na:    ['uso_herramientas', 'tipificacion'],
  },
  claro_hogar: {
    third_party:  ['interes_necesidades', 'habilidades_comerciales', 'resalta_beneficios', 'cierre_comercial', 'manejo_objeciones'],
    dropped_call: ['cierre_comercial', 'habilidades_comerciales', 'manejo_objeciones', 'despedida', 'tipificacion'],
    rejection:    ['cierre_comercial', 'habilidades_comerciales'],
    always_na:    ['uso_herramientas', 'tipificacion'],
  },
  claro_tyt: {
    third_party:  ['perfilamiento_enfocado', 'oferta_comercial', 'manejo_objeciones', 'cierre_comercial', 'convenios_bancarios'],
    dropped_call: ['cierre_comercial', 'convenios_bancarios', 'manejo_objeciones', 'despedida'],
    rejection:    ['cierre_comercial', 'convenios_bancarios'],
    always_na:    ['uso_herramientas'],
  },
  obama_ventas: {
    third_party:  ['contexto_personalizacion', 'cierre_experiencia', 'requisitos', 'cotizacion_ingresos', 'explicacion_cierre'],
    dropped_call: ['cierre_experiencia', 'requisitos', 'cotizacion_ingresos', 'explicacion_cierre'],
    rejection:    ['cotizacion_ingresos', 'explicacion_cierre'],
    always_na:    [],
  },
  obama_customer: {
    third_party:  ['recordatorio_plan', 'complementar_dental_vision'],
    dropped_call: ['cierre_efectivo', 'complementar_dental_vision', 'recordatorio_plan'],
    rejection:    ['complementar_dental_vision', 'cierre_efectivo'],
    always_na:    [],
  },
  lv_customer: {
    third_party:  ['cobros_prevencion_mora', 'cierre_llamada', 'notificaciones_seguimiento'],
    dropped_call: ['cierre_llamada', 'cobros_prevencion_mora', 'notificaciones_seguimiento'],
    rejection:    ['cierre_llamada', 'retencion_fidelizacion'],
    always_na:    [],
  },
  lv_ventas: {
    third_party:  ['gestion_comercial', 'reformulacion', 'cierre_llamada'],
    dropped_call: ['gestion_comercial', 'reformulacion', 'cierre_llamada'],
    rejection:    ['rebatimiento_cierre', 'reformulacion'],
    always_na:    [],
  },
};

const CLIENT_GROUPS = {
  claro_wcb:      'claro',
  claro_movil:    'claro',
  claro_pymes:    'claro',
  claro_hogar:    'claro',
  claro_tyt:      'claro',
  obama_ventas:   'obama',
  obama_customer: 'obama',
  lv_customer:    'lv',
  lv_ventas:      'lv',
  reclutamiento:  'reclutamiento',
};

exports.seed = async function (knex) {
  for (const [key, criteria] of Object.entries(CRITERIA)) {
    await knex('criteria_configs')
      .insert({
        campaign_key:         key,
        client_group:         CLIENT_GROUPS[key],
        campaign_label:       criteria.label,
        general_criteria:     JSON.stringify(criteria.general),
        high_impact_criteria: JSON.stringify(criteria.highImpact),
        na_rules:             JSON.stringify(NA_RULES[key] || { third_party: [], dropped_call: [], rejection: [], always_na: [] }),
        special_instructions: null,
        updated_by:           null,
      })
      .onConflict('campaign_key')
      .ignore();
  }
};
