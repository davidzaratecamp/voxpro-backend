/**
 * "Santi": auditoría automática masiva de grabaciones OUTBOUND (no del bot
 * SOFIA) a partir de una lista fija de teléfonos importada desde un Excel
 * de campaña (ej. P21 BOX PRO — CROSSELLING_MOVIL_SIN_HOGAR_P21, Claro Hogar
 * Outbound). Cada fila se empareja contra Aware (vía Kraken) por
 * teléfono + fecha exacta, y una vez encontrada la llamada real, reutiliza
 * el mismo pipeline de `recordings` + `audit_selections` + AnalysisService
 * que usan las auditorías manuales — sin duplicar lógica de descarga/scoring.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('santi_audits', (t) => {
    t.bigIncrements('id').primary();

    // Import batch (para saber de qué carga/Excel vino cada fila)
    t.string('import_batch', 150).notNullable();

    // Datos crudos relevantes del Excel (para mostrar/exportar sin tener que
    // volver a mirar el archivo original)
    t.string('phone', 30).notNullable();
    t.date('fecha_excel').notNullable();
    t.string('ciudad', 100).nullable();
    t.string('division_comercial', 100).nullable();
    t.string('nombre_campana', 150).nullable();
    t.string('aliado_asignado', 150).nullable();
    t.string('campana', 100).nullable();
    t.string('tipo_contacto', 100).nullable();
    t.string('claro_detalle', 300).nullable();
    t.string('codigo_claro_tipificacion', 20).nullable();
    t.integer('duracion_excel').unsigned().nullable();
    t.string('agente_id_excel', 30).nullable();
    t.integer('intentos_excel').unsigned().nullable();
    t.json('excel_raw').nullable(); // fila completa, por si se necesita algo más adelante

    // Resultado del emparejamiento contra Aware (AWARE_4 / claro_hogar)
    t.enum('status', ['pending', 'matched', 'not_found', 'done', 'error']).notNullable().defaultTo('pending');
    t.bigInteger('recording_id').unsigned().nullable().references('id').inTable('recordings');
    t.bigInteger('selection_id').unsigned().nullable().references('id').inTable('audit_selections');
    t.text('error_message').nullable();

    t.timestamps(true, true);

    t.index(['status']);
    t.index(['phone']);
    t.index(['import_batch']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('santi_audits');
};
