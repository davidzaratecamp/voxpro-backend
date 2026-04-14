/**
 * Criterios de evaluación de calidad por cliente.
 *
 * Estructura:
 *   general[]   — Items con peso porcentual. Cada uno es cumple/no cumple.
 *                  Score = suma de los % donde cumple.
 *   highImpact[] — Items críticos. Si CUALQUIERA no cumple → score total = 0.
 */

const CRITERIA = {
  // ─── Claro WCB ───────────────────────────────────────────────
  claro_wcb: {
    label: 'Claro WCB',
    general: [
      { key: 'cierre_comercial',          label: 'Cierre Comercial',                              weight: 12 },
      { key: 'interes_necesidades',       label: 'Interés por conocer las necesidades del cliente', weight: 10 },
      { key: 'oferta_comercial',          label: 'Oferta comercial',                               weight: 10 },
      { key: 'manejo_objeciones',         label: 'Manejo de objeciones',                           weight: 10 },
      { key: 'resalta_beneficios',        label: 'Resalta beneficios de Todo Claro',               weight: 9 },
      { key: 'escucha_activa',            label: 'Escucha Activa',                                 weight: 8 },
      { key: 'argumenta_conocimientos',   label: 'Argumenta con sus conocimientos',                weight: 8 },
      { key: 'amabilidad_empatia',        label: 'Amabilidad y Empatía',                           weight: 7 },
      { key: 'uso_herramientas',          label: 'Uso de Herramientas',                            weight: 7 },
      { key: 'tiempos_espera',            label: 'Tiempos de espera',                              weight: 5 },
      { key: 'comunicacion_efectiva',     label: 'Comunicación efectiva',                          weight: 5 },
      { key: 'saludo',                    label: 'Saludo',                                         weight: 3 },
      { key: 'despedida',                 label: 'Despedida',                                      weight: 3 },
      { key: 'tipificacion',             label: 'Tipificación',                                   weight: 3 },
    ],
    highImpact: [
      { key: 'maltrato_cliente',          label: 'Maltrato al Cliente' },
      { key: 'cuelgue_llamada',           label: 'Cuelgue de llamada' },
      { key: 'info_politicas',            label: 'Información correcta de políticas vigentes' },
      { key: 'info_herramientas',         label: 'Información correcta de herramientas' },
      { key: 'induce_cancelar',           label: 'Induce al cliente a cancelar el servicio' },
      { key: 'registro',                  label: 'Registro' },
      { key: 'fraude_comercial',          label: 'Fraude comercial' },
      { key: 'lectura_contrato',          label: 'Realiza lectura al 100% del contrato' },
      { key: 'gestion_comercial',         label: 'Gestión Comercial' },
      { key: 'consulta_sox',              label: 'Consulta SOX' },
    ],
  },

  // ─── Claro Hogar ─────────────────────────────────────────────
  claro_hogar: {
    label: 'Claro Hogar',
    general: [
      { key: 'manejo_objeciones',         label: 'Manejo de Objeciones',                           weight: 12 },
      { key: 'escucha_activa',            label: 'Escucha Activa',                                 weight: 10 },
      { key: 'interes_necesidades',       label: 'Interés por conocer la necesidad del cliente',   weight: 10 },
      { key: 'habilidades_comerciales',   label: 'Habilidades Comerciales',                        weight: 10 },
      { key: 'resalta_beneficios',        label: 'Resalta Beneficios Todo Claro',                  weight: 10 },
      { key: 'cierre_comercial',          label: 'Cierre Comercial',                               weight: 10 },
      { key: 'amabilidad_empatia',        label: 'Amabilidad y Empatía',                           weight: 8 },
      { key: 'argumenta_conocimientos',   label: 'Argumenta con tus conocimientos',                weight: 8 },
      { key: 'saludo',                    label: 'Saludo',                                         weight: 5 },
      { key: 'tiempos_espera',            label: 'Tiempos de espera',                              weight: 5 },
      { key: 'tipificacion',             label: 'Tipificación',                                   weight: 5 },
      { key: 'comunicacion_efectiva',     label: 'Comunicación efectiva',                          weight: 4 },
      { key: 'despedida',                 label: 'Despedida',                                      weight: 3 },
    ],
    highImpact: [
      { key: 'maltrato_cliente',          label: 'Maltrato al Cliente' },
      { key: 'cuelgue_llamada',           label: 'Cuelgue de llamada' },
      { key: 'proceso_venta',             label: 'Realiza Proceso de venta Correctamente' },
      { key: 'info_herramientas',         label: 'Brinda información correcta y completa acorde a las herramientas de gestión' },
      { key: 'induce_cancelar',           label: 'Induce al cliente a cancelar el servicio (Permanencia)' },
      { key: 'malas_practicas',           label: 'Malas prácticas' },
      { key: 'validacion_identidad',      label: 'Validación de identidad' },
      { key: 'fraude_comercial',          label: 'Fraude comercial' },
      { key: 'lectura_contrato',          label: 'Realiza lectura al 100% del contrato' },
      { key: 'gestion_comercial',         label: 'Gestión Comercial' },
      { key: 'consulta_sox',              label: 'Consulta SOX' },
    ],
  },

  // ─── Claro TYT ───────────────────────────────────────────────
  claro_tyt: {
    label: 'Claro TYT',
    general: [
      { key: 'saludo',                    label: 'Saludo',                                         weight: 12 },
      { key: 'perfilamiento_enfocado',    label: 'Perfilamiento Enfocado',                         weight: 12 },
      { key: 'manejo_objeciones',         label: 'Manejo de Objeciones',                           weight: 12 },
      { key: 'cierre_comercial',          label: 'Cierre Comercial',                               weight: 12 },
      { key: 'escucha_activa',            label: 'Escucha Activa',                                 weight: 10 },
      { key: 'oferta_comercial',          label: 'Oferta Claro / Ofrecimiento comercial',          weight: 10 },
      { key: 'uso_herramientas',          label: 'Uso de Herramientas',                            weight: 7 },
      { key: 'tiempos_espera',            label: 'Tiempos de espera',                              weight: 5 },
      { key: 'comunicacion_efectiva',     label: 'Comunicación efectiva',                          weight: 5 },
      { key: 'amabilidad_empatia',        label: 'Amabilidad y Empatía',                           weight: 5 },
      { key: 'convenios_bancarios',       label: 'Convenios bancarios',                            weight: 5 },
      { key: 'despedida',                 label: 'Despedida',                                      weight: 5 },
    ],
    highImpact: [
      { key: 'maltrato_cliente',          label: 'Maltrato al Cliente' },
      { key: 'cuelgue_llamada',           label: 'Cuelgue de llamada' },
      { key: 'fraude_comercial',          label: 'Fraude Comercial' },
      { key: 'lenguaje_negativo',         label: 'Lenguaje Negativo' },
      { key: 'induce_cancelar',           label: 'Induce al cliente a cancelar el servicio (Retracto)' },
      { key: 'lectura_contrato',          label: 'Realiza lectura al 100% del contrato' },
      { key: 'proceso_estipulado',        label: 'Genera el proceso de acuerdo a lo estipulado' },
      { key: 'oferta_venta_contado',      label: 'Oferta Venta de Contado' },
      { key: 'gestion_comercial',         label: 'Gestión Comercial' },
      { key: 'habeas_data',               label: 'Habeas data' },
      { key: 'oferta_claro_up',           label: 'Oferta Claro up' },
      { key: 'consulta_sox',              label: 'Consulta SOX' },
    ],
  },

  // ─── Obama Ventas ────────────────────────────────────────────
  // Aware 30 (agentes de ventas), Aware 31, Aware 5
  obama_ventas: {
    label: 'Obama Ventas',
    general: [
      { key: 'inicio_llamada',            label: 'Inicio De La Llamada',                           weight: 10 },
      { key: 'contexto_personalizacion',  label: 'Contexto De La Llamada Y Personalización',       weight: 20 },
      { key: 'empatia_trato',             label: 'Empatía Y Trato Al Cliente',                     weight: 10 },
      { key: 'cierre_experiencia',        label: 'Cierre De La Fase De Experiencia',               weight: 15 },
      { key: 'requisitos',                label: 'Requisitos',                                     weight: 15 },
      { key: 'cotizacion_ingresos',       label: 'Cotización Y Validación De Ingresos',            weight: 15 },
      { key: 'explicacion_cierre',        label: 'Explicación Del Servicio Y Cierre De Venta',     weight: 15 },
    ],
    highImpact: [
      { key: 'solicitud_referidos',       label: 'Solicitud De Referidos' },
      { key: 'seguimiento_postventa',     label: 'Seguimiento Y Postventa' },
      { key: 'asignacion_polizas_taxes',  label: 'Asignación De Pólizas Según Declaración De Taxes' },
      { key: 'firma_carta',               label: 'Firma De La Carta' },
      { key: 'solicitud_documentacion',   label: 'Solicitud De Documentación' },
      { key: 'pago_automatico_prima',     label: 'Pago Automático En Pólizas Con Prima' },
      { key: 'falta_empatia',             label: 'Falta de empatía con el cliente' },
      { key: 'falta_gestion_comercial',   label: 'Falta de gestión comercial' },
      { key: 'tipificacion_correcta',     label: 'Tipificación Correcta De La Llamada' },
      { key: 'maltrato_cliente',          label: 'Maltrato Al Cliente' },
      { key: 'guion_aor',                 label: 'Guion AOR' },
      { key: 'cuelgue_llamada',           label: 'Cuelgue De Llamada' },
      { key: 'fraude_comercial',          label: 'Fraude Comercial' },
      { key: 'recapitulacion_venta',      label: 'Recapitulación De Venta' },
      { key: 'validacion_requisitos',     label: 'Validación De Requisitos De Ingreso' },
      { key: 'pregunta_taxes',            label: 'Pregunta taxes' },
      { key: 'guion_paro',                label: 'Guion de paro' },
      { key: 'actualizacion_bronce',      label: 'Actualización póliza bronce' },
    ],
  },

  // ─── Obama Customer ──────────────────────────────────────────
  // Solo agentes específicos del Aware 30
  obama_customer: {
    label: 'Obama Customer',
    general: [
      { key: 'saludo_presentacion',       label: 'Saludo y Presentación',                          weight: 10 },
      { key: 'empatia_experiencia',       label: 'Empatía y experiencia del cliente',              weight: 20 },
      { key: 'recordatorio_plan',         label: 'Recordatorio de plan y cobertura',               weight: 20 },
      { key: 'comunicacion_efectiva',     label: 'Comunicación efectiva',                          weight: 5 },
      { key: 'resolucion_primer_contacto',label: 'Resolución en primer contacto',                  weight: 10 },
      { key: 'productividad_marcaciones', label: 'Productividad (marcaciones mínimas)',            weight: 10 },
      { key: 'cierre_efectivo',           label: 'Cierre Efectivo',                                weight: 10 },
      { key: 'complementar_dental_vision',label: 'Opción de complementar dental y visión',         weight: 15 },
    ],
    highImpact: [
      { key: 'no_referido',               label: 'No referido' },
      { key: 'no_gestion_recuperacion',   label: 'No Gestión de recuperación' },
      { key: 'maltrato_cliente',          label: 'Maltrato al cliente' },
      { key: 'no_marcaciones',            label: 'No marcaciones' },
      { key: 'fraude_comercial',          label: 'Fraude comercial' },
      { key: 'cuelgue_llamada',           label: 'Cuelgue llamada' },
      { key: 'documentos_ingresos',       label: 'Documentos e ingresos' },
      { key: 'guion_aor',                 label: 'Guion AOR' },
      { key: 'recapitulacion',            label: 'Recapitulación' },
      { key: 'cobro',                     label: 'Cobro' },
      { key: 'falta_gestion_comercial',   label: 'Falta de gestión comercial' },
      { key: 'pregunta_taxes',            label: 'Pregunta taxes' },
      { key: 'falta_empatia',             label: 'Falta de empatía con el cliente' },
      { key: 'guion_paro',                label: 'Guion de paro' },
      { key: 'actualizacion_bronce',      label: 'Actualización póliza bronce' },
    ],
  },
  // ─── LV (Vital Health) Customer ─────────────────────────────
  lv_customer: {
    label: 'LV Customer',
    general: [
      // Protocolos de identificación y comunicación
      { key: 'bienvenida_corporativa',      label: 'Bienvenida Corporativa (saludo formal, nombre del agente y mención de Vital Health Insurance)', weight: 5 },
      { key: 'identificacion_otp',          label: 'Identificación y OTP (validación por palabra de seguridad, fecha de nacimiento o últimos 4 del SS)', weight: 5 },
      { key: 'inteligencia_emocional',      label: 'Inteligencia Emocional (empatía activa, validar emociones del cliente, actitud resolutiva)',      weight: 5 },
      { key: 'canales_digitales',           label: 'Canales Digitales (respuestas prontas en WhatsApp, último mensaje del agente)',                   weight: 5 },
      { key: 'comunicacion_profesional',    label: 'Comunicación Profesional (uso del nombre del cliente, evitar tecnicismos, validar comprensión)',  weight: 10 },
      // Gestión operativa y de producto
      { key: 'conocimiento_producto',       label: 'Conocimiento de Producto (créditos fiscales, planes HMO/PPO/EPO, copagos, deducibles, impacto de cambios de ingresos)', weight: 10 },
      { key: 'gestion_tiempos',             label: 'Gestión de Tiempos (respetar horario de contactabilidad, programar seguimientos con fecha y hora exacta)', weight: 10 },
      { key: 'trazabilidad_documentacion',  label: 'Trazabilidad y Documentación (actualizar CRM con iniciales y fecha, firma CMS solo con autorización)', weight: 10 },
      { key: 'postventa',                   label: 'Postventa (correo de bienvenida día 1, paquete físico días 2-8 con llamada de confirmación)',      weight: 5 },
      // Educación financiera y cobranza
      { key: 'cobranza_preventiva',         label: 'Cobranza Preventiva (fechas de pago 15/25/01, riesgos de mora ante IRS y suspensión de cobertura)', weight: 10 },
      { key: 'educacion_financiera',        label: 'Educación Financiera (pagos anticipados, métodos de pago, promoción de Autopay)',                  weight: 10 },
      // Retención y experiencia final
      { key: 'resolucion_casos',            label: 'Resolución de Casos (diagnóstico correcto, soluciones integrales sin evadir dudas)',              weight: 5 },
      { key: 'retencion_fidelizacion',      label: 'Retención y Fidelización (identificar señales de cancelación, ofrecer alternativas, solicitar referidos)', weight: 5 },
      { key: 'experiencia_cliente',         label: 'Experiencia al Cliente (confirmar satisfacción total antes de finalizar)',                        weight: 5 },
    ],
    highImpact: [
      { key: 'maltrato_cliente',            label: 'Maltrato al cliente (ironía, falta de respeto o nula empatía)' },
      { key: 'cuelgue_llamada',             label: 'Cuelgue o abandono (finalizar abruptamente o abandonar al cliente en línea)' },
      { key: 'no_gestion_pago',             label: 'No incentivar el pago ni recordar la prima' },
      { key: 'no_riesgos_mora',             label: 'No explicar riesgos de mora ante el IRS' },
      { key: 'no_autopay',                  label: 'No sugerir pago automático (Autopay)' },
      { key: 'firma_sin_autorizacion',      label: 'Firmar documentos (CMS) sin autorización del líder y del cliente' },
      { key: 'no_registro_crm',             label: 'No registrar correctamente en el CRM (con iniciales y fecha)' },
      { key: 'incumplir_horario',           label: 'Contactar al cliente fuera del horario autorizado' },
    ],
  },

  // ─── Reclutamiento ───────────────────────────────────────────
  reclutamiento: {
    label: 'Reclutamiento',
    general: [
      {
        key: 'saludo_presentacion',
        label: 'Saludo y Presentación',
        weight: 15,
        description: 'Evalúa: (1) Uso de saludo cordial y tono adecuado ("Buenos días / buenas tardes..."). (2) Confirmar identidad del candidato ("¿Hablo con...?"). (3) Identificación del analista por nombre. (4) Identificación de la empresa: mencionar "ASISTE ING" o el área de reclutamiento. (5) Motivo del contacto: explicar por qué se llama (aplicación a una vacante).',
      },
      {
        key: 'perfilamiento',
        label: 'Perfilamiento',
        weight: 25,
        description: 'Evalúa: (1) Validación de experiencia relacionada (ventas, call center, servicio al cliente, etc.). (2) Tiempo de experiencia en roles de asesor comercial. (3) Tipo de experiencia: funciones realizadas (ventas telefónicas, presenciales, soporte, etc.). (4) Cumplimiento de metas: si ha trabajado bajo indicadores o metas comerciales. (5) Interés real en la vacante mediante preguntas de profundización.',
      },
      {
        key: 'oferta',
        label: 'Oferta',
        weight: 30,
        description: 'Evalúa: (1) Presentación clara del nombre del cargo. (2) Explicación de las funciones principales. (3) Tipo de campaña o producto a vender o gestionar. (4) Condiciones salariales: sueldo base, incentivos y bonificaciones. (5) Tipo de contrato y vinculación. (6) Horario laboral: turnos y mallas de trabajo. (7) Lugar o modalidad: presencial, remoto o híbrido, con ubicación de la sede. (8) Beneficios o propuesta de valor: crecimiento, fondo de empleados, caja de compensación, etc. (9) Claridad y orden: la explicación debe ser estructurada y fácil de entender.',
      },
      {
        key: 'manejo_objeciones',
        label: 'Manejo de Objeciones',
        weight: 10,
        description: 'Evalúa: (1) Identificación correcta de la duda o resistencia del candidato. (2) Escucha activa: permite que el candidato se exprese sin interrupciones. (3) Claridad en la respuesta con información concreta y veraz. (4) Argumentación usando beneficios de la oferta (estabilidad, comisiones) para persuadir. (5) Seguridad y control de la conversación. (6) Validación de que la explicación resolvió la duda. (7) Retoma del proceso tras resolver la objeción.',
      },
      {
        key: 'cierre_citacion',
        label: 'Cierre de Citación',
        weight: 20,
        description: 'Evalúa: (1) Propuesta formal de siguiente paso (entrevista o prueba). (2) Información completa de la cita: fecha, hora y modalidad. (3) Ubicación o acceso: direcciones, estaciones cercanas o links de mapas. (4) Indicaciones para el proceso: qué debe preparar o llevar el candidato (documentos, HV). (5) Confirmación de disponibilidad y asistencia del candidato. (6) Verificación del medio por el cual se enviará el respaldo de la información. (7) Despedida profesional con agradecimiento y cordialidad.',
      },
    ],
    highImpact: [
      { key: 'informacion_falsa',         label: 'Brindar información falsa o engañosa sobre la vacante o la empresa' },
      { key: 'maltrato_candidato',        label: 'Maltrato o trato irrespetuoso al candidato' },
      { key: 'cuelgue_llamada',           label: 'Cuelgue abrupto de la llamada' },
      { key: 'no_identificacion',         label: 'No verificar el nombre ni la identidad del candidato' },
      { key: 'no_pasos_siguientes',       label: 'No indicar los pasos siguientes del proceso de selección' },
    ],
  },

  // ─── LV (Vital Health) Ventas ────────────────────────────────
  lv_ventas: {
    label: 'LV Ventas',
    general: [
      { key: 'inicio_llamada',              label: 'Inicio de la Llamada (presentación profesional, motivo de la llamada y validación de identidad/OTP)', weight: 10 },
      { key: 'sondeo',                      label: 'Sondeo (seguro actual, elegibilidad migratoria, núcleo familiar/taxes, ingresos W2 o 1099, prioridades médicas o medicamentos)', weight: 15 },
      { key: 'rebatimiento_cierre',         label: 'Rebatimiento y Cierre de la Oferta (mínimo 3 objeciones manejadas, liderazgo, conversación cerrada)', weight: 20 },
      { key: 'reformulacion',               label: 'Reformulación (recapitulación de ingresos, subsidio y costo final antes del consentimiento)',        weight: 15 },
      { key: 'conocimiento_producto',       label: 'Conocimiento del Producto (Ley Obamacare, créditos fiscales, copagos, deducibles, redes HMO/PPO/EPO)', weight: 15 },
      { key: 'cierre_llamada',              label: 'Cierre de Llamada (cortesía, número de contacto Vital 305-703-6455, solicitud de referidos)',        weight: 13 },
      { key: 'atencion_cliente',            label: 'Atención al Cliente (generación de experiencia positiva durante toda la llamada)',                   weight: 12 },
    ],
    highImpact: [
      { key: 'fraude_comercial',            label: 'Fraude Comercial (manipular datos, digitar pólizas falsas o prometer beneficios inexistentes)' },
      { key: 'maltrato_cliente',            label: 'Maltrato al cliente (impaciencia o trato irrespetuoso)' },
      { key: 'cuelgue_sin_despedida',       label: 'Colgar la llamada sin despedida' },
      { key: 'no_recapitulacion',           label: 'No realizar la recapitulación de la venta (ingresos, subsidio, costo final)' },
      { key: 'firma_sin_autorizacion',      label: 'Firmar documentos sin autorización del cliente' },
      { key: 'tipificacion_crm',            label: 'Tipificar mal la llamada en el CRM' },
      { key: 'incumplir_horario',           label: 'Contactar al cliente fuera del horario acordado' },
      { key: 'doble_cobertura',             label: 'No advertir sobre doble cobertura (dos seguros ACA activos simultáneos)' },
      { key: 'obligaciones_fiscales',       label: 'No informar obligaciones fiscales (subsidio como crédito adelantado, riesgo de devolución)' },
      { key: 'pagos_anticipados',           label: 'No informar que los pagos realizados son anticipados' },
    ],
  },
};

/**
 * Proyecto IDs de LV en AWARE_30.
 * 34 = LV-VENTAS, 35 = LV_CUSTOMER, 36 = LV_COBROS (no auditable por ahora)
 */
const LV_PROYECTO_IDS = new Set([34, 35]);
const LV_CUSTOMER_PROYECTO = 35;
const LV_VENTAS_PROYECTO = 34;

/**
 * Retorna los criterios para un client_code y agent_id dados.
 * Para Obama, distingue entre Ventas y Customer por cédula del agente.
 * Para LV, distingue entre Ventas y Customer por proyecto_id.
 * @param {string} clientCode
 * @param {string} [agentId]
 * @param {number} [proyectoId]
 * @returns {object|null}
 */
function getCriteria(clientCode, agentId, proyectoId) {
  if (clientCode === 'obama') {
    return CRITERIA.obama_ventas; // routing dinámico via HC — ver resolveObamaAgentCampaign
  }
  if (clientCode === 'lv') {
    if (proyectoId === LV_CUSTOMER_PROYECTO) {
      return CRITERIA.lv_customer;
    }
    return CRITERIA.lv_ventas;
  }
  if (clientCode === 'reclutamiento') {
    return CRITERIA.reclutamiento;
  }
  return CRITERIA[clientCode] || null;
}

module.exports = { CRITERIA, LV_PROYECTO_IDS, LV_CUSTOMER_PROYECTO, LV_VENTAS_PROYECTO, getCriteria };
