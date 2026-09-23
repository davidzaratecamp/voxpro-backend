/**
 * Obama Vital: la operación de Obama reestructurada (sep 2026) sobre un Aware
 * nuevo (asiste2.awareccm.com, ver config/obamaVitalSource.js). Módulo aparte
 * del "obama" histórico y de "lv" (Vital Health):
 *
 *  - Rol nuevo `auditor_obama_vital`: audita y además alimenta sus matrices.
 *  - Tabla propia `obama_vital_audits`: una auditoría por llamada. Los campos
 *    de la llamada se snapshotean al seleccionar, porque no se puede hacer
 *    JOIN entre MySQL y el Postgres externo. Se guarda también el puntaje
 *    original de la IA (ai_score) para poder medir cuánto corrige el auditor.
 *  - Dos matrices en criteria_configs (client_group 'obama_vital'):
 *    Bienvenida (outbound, proyectos 10/11) y ObamaCus (inbound, 2/4/5/6).
 *    Arrancan como copia de obama_ventas / obama_customer para que el auditor
 *    las ajuste desde Configuración.
 */

const ROLES_BEFORE = [
  'coordinator', 'formador', 'auditor_obama', 'auditor_claro', 'auditor_lv', 'auditor_reclutamiento',
  'coordinator_obama', 'coordinator_reclutamiento', 'supervisor_calidad', 'viewer_zoom', 'gestor_usuarios',
  'coordinador_avaya', 'auditor_ia',
];
const ROLES_AFTER = [...ROLES_BEFORE, 'auditor_obama_vital'];

// mysql2 devuelve las columnas JSON ya parseadas: hay que volver a serializar.
const asJson = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

const enumSql = (roles) =>
  `ALTER TABLE users MODIFY COLUMN role ENUM(${roles.map((r) => `'${r}'`).join(',')}) NOT NULL`;

const MATRICES = [
  { campaign_key: 'obama_vital_bienvenida', campaign_label: 'Obama Vital — Bienvenida', copyFrom: 'obama_ventas' },
  { campaign_key: 'obama_vital_customer',   campaign_label: 'Obama Vital — ObamaCus',   copyFrom: 'obama_customer' },
];

// Solo si la matriz de origen no existe (DB nueva): una matriz mínima válida
// (pesos suman 100) para que Configuración pueda abrirla y editarla.
const FALLBACK = {
  general: [
    { key: 'saludo',                label: 'Saludo y presentación',  weight: 20 },
    { key: 'comunicacion_efectiva', label: 'Comunicación efectiva',  weight: 40 },
    { key: 'cierre',                label: 'Cierre de la llamada',   weight: 40 },
  ],
  highImpact: [
    { key: 'maltrato_cliente', label: 'Maltrato al cliente' },
  ],
  naRules: {},
};

exports.up = async function (knex) {
  await knex.raw(enumSql(ROLES_AFTER));

  // Idempotente: un primer intento falló después de crear la tabla (MySQL no
  // revierte DDL), así que no se vuelve a crear si ya existe.
  const hasTable = await knex.schema.hasTable('obama_vital_audits');
  if (!hasTable) await knex.schema.createTable('obama_vital_audits', (t) => {
    t.bigIncrements('id').primary();
    t.integer('registro_llamada_id').notNullable().unique();
    t.integer('proyecto_id').notNullable();
    t.string('campaign', 20).notNullable();
    t.string('campaign_key', 30).notNullable();
    t.string('agente_id', 20).notNullable();
    t.string('agente_nombre', 150).nullable();
    t.string('telefono', 20).nullable();
    t.date('fecha').notNullable();
    t.time('hora').nullable();
    t.integer('duracion').unsigned().nullable();
    t.string('audiofile', 300).nullable();
    t.integer('auditor_id').unsigned().nullable().references('id').inTable('users');
    t.enum('status', ['selected', 'in_review', 'completed', 'skipped']).defaultTo('selected');
    t.integer('score').unsigned().nullable();
    t.json('criteria_general').nullable();
    t.json('criteria_high_impact').nullable();
    t.boolean('high_impact_failed').defaultTo(false);
    t.text('notes').nullable();
    t.text('transcription', 'mediumtext').nullable();
    t.integer('ai_score').unsigned().nullable();
    t.boolean('ai_high_impact_failed').nullable();
    t.timestamp('analyzed_at').nullable();
    t.timestamp('scored_at').nullable();
    t.timestamps(true, true);

    t.index(['fecha']);
    t.index(['agente_id']);
    t.index(['status']);
  });

  for (const m of MATRICES) {
    const exists = await knex('criteria_configs').where('campaign_key', m.campaign_key).first();
    if (exists) continue;

    const source = await knex('criteria_configs').where('campaign_key', m.copyFrom).first();
    await knex('criteria_configs').insert({
      campaign_key:         m.campaign_key,
      client_group:         'obama_vital',
      campaign_label:       m.campaign_label,
      general_criteria:     asJson(source ? source.general_criteria : FALLBACK.general),
      high_impact_criteria: asJson(source ? source.high_impact_criteria : FALLBACK.highImpact),
      na_rules:             asJson(source ? source.na_rules : FALLBACK.naRules),
      special_instructions: source ? source.special_instructions : null,
      updated_by:           null,
    });
  }
};

exports.down = async function (knex) {
  await knex('criteria_configs').whereIn('campaign_key', MATRICES.map((m) => m.campaign_key)).delete();
  await knex.schema.dropTableIfExists('obama_vital_audits');
  // Si todavía hay usuarios con el rol, MySQL rechaza el ALTER: hay que
  // cambiarles el rol a mano antes de revertir (no se borran usuarios aquí).
  await knex.raw(enumSql(ROLES_BEFORE));
};
