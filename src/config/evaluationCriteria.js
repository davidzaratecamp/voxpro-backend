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
  // ─── LV (Luis Vittier / Vital Health) Customer ──────────────
  lv_customer: {
    label: 'LV Customer',
    general: [
      { key: 'saludo_otp',                  label: 'Saludo Corporativo y Verificación OTP',            weight: 10 },
      { key: 'habilidades_comunicativas',   label: 'Habilidades Comunicativas',                        weight: 40 },
      { key: 'resolucion_primer_contacto',  label: 'Resolución en Primer Contacto',                    weight: 15 },
      { key: 'notificaciones_seguimiento',  label: 'Notificaciones y Seguimiento',                     weight: 5 },
      { key: 'cobros_prevencion_mora',      label: 'Gestión de Cobros y Prevención de Mora',           weight: 10 },
      { key: 'cierre_llamada',              label: 'Cierre de la Llamada',                             weight: 15 },
      { key: 'experiencia_cliente',         label: 'Experiencia del Cliente',                          weight: 5 },
    ],
    highImpact: [
      { key: 'no_gestion_pago',             label: 'No gestionar pago o recordatorio de prima' },
      { key: 'no_autopay',                  label: 'No sugerir pago automático (Autopay)' },
      { key: 'no_riesgos_mora',             label: 'No explicar riesgos de mora' },
      { key: 'no_confirmar_paquete',        label: 'No confirmar recepción de tarjetas/paquete de bienvenida' },
      { key: 'maltrato_cliente',            label: 'Maltrato al cliente' },
      { key: 'cuelgue_llamada',             label: 'Colgar la llamada abruptamente' },
      { key: 'no_referidos',                label: 'No solicitar referidos al finalizar' },
      { key: 'incumplir_horario',           label: 'Incumplir horario de contacto del cliente' },
      { key: 'firma_sin_autorizacion',      label: 'Firmar documentos sin autorización' },
      { key: 'no_registro_crm',             label: 'No registrar correctamente en el CRM' },
    ],
  },

  // ─── LV (Luis Vittier / Vital Health) Ventas ───────────────
  lv_ventas: {
    label: 'LV Ventas',
    general: [
      { key: 'inicio_llamada',       label: 'Inicio de la Llamada (Saludo Corporativo)',                     weight: 10 },
      { key: 'gestion_comercial',    label: 'Gestión Comercial (Sondeo, Rebatimiento y Cierre)',             weight: 50 },
      { key: 'reformulacion',        label: 'Reformulación (Recapitulación breve)',                          weight: 10 },
      { key: 'cierre_llamada',       label: 'Cierre de Llamada (Despedida Corporativa)',                     weight: 10 },
      { key: 'atencion_cliente',     label: 'Atención al Cliente (Fidelidad y Experiencia)',                 weight: 20 },
    ],
    highImpact: [
      { key: 'fraude_comercial',         label: 'Fraude Comercial (manipular datos, pólizas falsas, prometer beneficios incorrectos)' },
      { key: 'gestion_venta',           label: 'Gestión de Venta (no recapitular prima, deducible, aseguradora o no confirmar activación)' },
      { key: 'documentacion',           label: 'Documentación (no validar ni guiar envío de documentos solicitados)' },
      { key: 'conducta_protocolo',       label: 'Conducta y Protocolo (maltrato, colgar sin despedida, incumplir horario)' },
    ],
  },
};

/**
 * Cédulas de los agentes de Customer en Aware 30.
 * El resto de agentes de Obama (Aware 30, 31, 5) son Ventas.
 */
const OBAMA_CUSTOMER_AGENTS = new Set([
  '1000834615', // Hernandez Mendoza David Ismael
  '1052837193', // Arguello Rodriguez Andres Felipe
  '1032679644', // Beltran Viracacha Paula Nicole
  '1028662379', // Ramirez Romero William Daniel
  '1023373202', // Chapeton Ardila Juan Sebastian
  '1001343678', // Arevalo Traslaviña Davinson Denet
  '1030659472', // Cordoba Gil Brandon David
  '1024600780', // Villalba Londoño Cristian David
  '1032938838', // Alvarez Alba Carol Natalia
  '1011093984', // Rodriguez Sierra Paola Alejandra
]);

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
    if (agentId && OBAMA_CUSTOMER_AGENTS.has(String(agentId))) {
      return CRITERIA.obama_customer;
    }
    return CRITERIA.obama_ventas;
  }
  if (clientCode === 'lv') {
    if (proyectoId === LV_CUSTOMER_PROYECTO) {
      return CRITERIA.lv_customer;
    }
    return CRITERIA.lv_ventas;
  }
  return CRITERIA[clientCode] || null;
}

module.exports = { CRITERIA, OBAMA_CUSTOMER_AGENTS, LV_PROYECTO_IDS, LV_CUSTOMER_PROYECTO, LV_VENTAS_PROYECTO, getCriteria };
