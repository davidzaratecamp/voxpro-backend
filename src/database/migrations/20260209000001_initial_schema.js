/**
 * Esquema inicial de VoxPro.
 *
 * Tablas:
 *   clients         - Clientes del call center (Obama, Majority, Claro...)
 *   aware_sources    - Carpetas Aware mapeadas a clientes
 *   recordings       - Cada archivo de grabación detectado
 *   processing_jobs  - Log de ejecuciones de escaneo/procesamiento
 *   transcriptions   - (futuro) Resultados de speech-to-text
 *   qa_evaluations   - (futuro) Evaluaciones de calidad con IA
 */

exports.up = async function (knex) {
  // -- Clientes --
  await knex.schema.createTable('clients', (t) => {
    t.increments('id').primary();
    t.string('name', 100).notNullable();
    t.string('code', 50).notNullable().unique();
    t.boolean('active').defaultTo(true);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // -- Fuentes Aware --
  await knex.schema.createTable('aware_sources', (t) => {
    t.increments('id').primary();
    t.integer('client_id').unsigned().notNullable();
    t.string('folder_name', 100).notNullable().unique();
    t.boolean('active').defaultTo(true);
    t.timestamp('created_at').defaultTo(knex.fn.now());

    t.foreign('client_id').references('id').inTable('clients');
  });

  // -- Grabaciones --
  await knex.schema.createTable('recordings', (t) => {
    t.bigIncrements('id').primary();
    t.integer('aware_source_id').unsigned().notNullable();
    t.string('file_name', 255).notNullable();
    t.string('file_path', 700).notNullable();
    t.string('file_path_hash', 64).notNullable().comment('SHA-256 del file_path para índice único');
    t.bigInteger('file_size').unsigned().defaultTo(0);
    t.date('file_date').nullable();
    t.string('call_phone', 50).nullable();
    t.string('call_id', 200).nullable();
    t.boolean('is_queue_call').defaultTo(false);
    t.enum('status', [
      'pending',
      'processing',
      'transcribed',
      'analyzed',
      'error',
      'skipped',
    ]).defaultTo('pending');
    t.text('error_message').nullable();
    t.timestamp('discovered_at').defaultTo(knex.fn.now());
    t.timestamp('processed_at').nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());

    t.unique(['file_path_hash'], { indexName: 'uq_file_path_hash' });
    t.foreign('aware_source_id').references('id').inTable('aware_sources');
    t.index(['status'], 'idx_status');
    t.index(['file_date'], 'idx_file_date');
    t.index(['aware_source_id', 'file_date'], 'idx_source_date');
  });

  // -- Jobs de procesamiento --
  await knex.schema.createTable('processing_jobs', (t) => {
    t.bigIncrements('id').primary();
    t.enum('job_type', ['scan', 'transcription', 'analysis']).notNullable();
    t.enum('status', ['running', 'completed', 'failed']).defaultTo('running');
    t.timestamp('started_at').defaultTo(knex.fn.now());
    t.timestamp('completed_at').nullable();
    t.integer('files_found').unsigned().defaultTo(0);
    t.integer('files_new').unsigned().defaultTo(0);
    t.integer('files_error').unsigned().defaultTo(0);
    t.text('error_message').nullable();
    t.json('metadata').nullable();
  });

  // -- Transcripciones (futuro) --
  await knex.schema.createTable('transcriptions', (t) => {
    t.bigIncrements('id').primary();
    t.bigInteger('recording_id').unsigned().notNullable().unique();
    t.text('transcript_text', 'longtext').nullable();
    t.string('language', 10).defaultTo('es');
    t.decimal('confidence', 5, 4).nullable();
    t.integer('duration_seconds').unsigned().nullable();
    t.string('engine', 50).nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());

    t.foreign('recording_id').references('id').inTable('recordings');
  });

  // -- Evaluaciones QA (futuro) --
  await knex.schema.createTable('qa_evaluations', (t) => {
    t.bigIncrements('id').primary();
    t.bigInteger('recording_id').unsigned().notNullable();
    t.bigInteger('transcription_id').unsigned().nullable();
    t.decimal('score', 5, 2).nullable();
    t.json('criteria').nullable();
    t.text('summary').nullable();
    t.string('evaluator', 50).nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());

    t.foreign('recording_id').references('id').inTable('recordings');
    t.foreign('transcription_id').references('id').inTable('transcriptions');
    t.index(['recording_id'], 'idx_qa_recording');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('qa_evaluations');
  await knex.schema.dropTableIfExists('transcriptions');
  await knex.schema.dropTableIfExists('processing_jobs');
  await knex.schema.dropTableIfExists('recordings');
  await knex.schema.dropTableIfExists('aware_sources');
  await knex.schema.dropTableIfExists('clients');
};
