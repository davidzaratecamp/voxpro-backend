/**
 * Inserta las matrices de calidad para Claro Móvil y Claro PYMES.
 *
 * Ambas son sub-campañas del servidor AWARE_34 (claro_wcb), distinguidas
 * por proyecto_id. GeminiService ya resuelve el campaign_key correcto
 * según los IDs de proyecto:
 *   - claro_movil: proyecto_ids 24, 25, 26, 28, 40, 43
 *   - claro_pymes: proyecto_ids 36, 37, 38, 39, 42, 45
 *
 * Se insertan con los mismos criterios que claro_wcb como punto de partida.
 * Los supervisores pueden ajustar los pesos desde Configuración.
 */

const generalCriteria = [
  { key: 'cierre_comercial',        label: 'Cierre Comercial',                               weight: 12 },
  { key: 'interes_necesidades',     label: 'Interés por conocer las necesidades del cliente', weight: 10 },
  { key: 'oferta_comercial',        label: 'Oferta comercial',                               weight: 10 },
  { key: 'manejo_objeciones',       label: 'Manejo de objeciones',                           weight: 10 },
  { key: 'resalta_beneficios',      label: 'Resalta beneficios de Todo Claro',               weight: 9  },
  { key: 'escucha_activa',          label: 'Escucha Activa',                                 weight: 8  },
  { key: 'argumenta_conocimientos', label: 'Argumenta con sus conocimientos',                weight: 8  },
  { key: 'amabilidad_empatia',      label: 'Amabilidad y Empatía',                           weight: 7  },
  { key: 'uso_herramientas',        label: 'Uso de Herramientas',                            weight: 7  },
  { key: 'tiempos_espera',          label: 'Tiempos de espera',                              weight: 5  },
  { key: 'comunicacion_efectiva',   label: 'Comunicación efectiva',                          weight: 5  },
  { key: 'saludo',                  label: 'Saludo',                                         weight: 3  },
  { key: 'despedida',               label: 'Despedida',                                      weight: 3  },
  { key: 'tipificacion',            label: 'Tipificación',                                   weight: 3  },
];

const highImpactCriteria = [
  { key: 'maltrato_cliente',  label: 'Maltrato al Cliente' },
  { key: 'cuelgue_llamada',   label: 'Cuelgue de llamada' },
  { key: 'info_politicas',    label: 'Información correcta de políticas vigentes' },
  { key: 'info_herramientas', label: 'Información correcta de herramientas' },
  { key: 'induce_cancelar',   label: 'Induce al cliente a cancelar el servicio' },
  { key: 'registro',          label: 'Registro' },
  { key: 'fraude_comercial',  label: 'Fraude comercial' },
  { key: 'lectura_contrato',  label: 'Realiza lectura al 100% del contrato' },
  { key: 'gestion_comercial', label: 'Gestión Comercial' },
  { key: 'consulta_sox',      label: 'Consulta SOX' },
];

const naRules = {
  third_party:  ['interes_necesidades', 'oferta_comercial', 'manejo_objeciones', 'cierre_comercial', 'resalta_beneficios'],
  dropped_call: ['cierre_comercial', 'manejo_objeciones', 'despedida', 'tipificacion'],
  rejection:    ['cierre_comercial'],
  always_na:    ['uso_herramientas', 'tipificacion'],
};

exports.up = async (knex) => {
  const rows = [
    {
      campaign_key:         'claro_movil',
      client_group:         'claro',
      campaign_label:       'Claro Móvil',
      general_criteria:     JSON.stringify(generalCriteria),
      high_impact_criteria: JSON.stringify(highImpactCriteria),
      na_rules:             JSON.stringify(naRules),
      special_instructions: null,
      updated_by:           null,
    },
    {
      campaign_key:         'claro_pymes',
      client_group:         'claro',
      campaign_label:       'Claro PYMES',
      general_criteria:     JSON.stringify(generalCriteria),
      high_impact_criteria: JSON.stringify(highImpactCriteria),
      na_rules:             JSON.stringify(naRules),
      special_instructions: null,
      updated_by:           null,
    },
  ];

  for (const row of rows) {
    const exists = await knex('criteria_configs').where('campaign_key', row.campaign_key).first();
    if (!exists) {
      await knex('criteria_configs').insert(row);
    }
  }
};

exports.down = async (knex) => {
  await knex('criteria_configs').whereIn('campaign_key', ['claro_movil', 'claro_pymes']).delete();
};
