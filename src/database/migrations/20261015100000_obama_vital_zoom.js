/**
 * Asiste (obama_vital) también audita llamadas de Zoom Phone: los agentes de
 * Asiste llaman tanto por Aware como por Zoom (misma cuenta de Zoom que usa el
 * módulo de Obama). Una auditoría de Zoom se identifica por
 * uniqueid = "zoom:<id de la grabación>" y su audio se descarga de `audio_url`
 * con el token de Zoom (no hay audiofile de Aware).
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn('obama_vital_audits', 'source'))) {
    await knex.schema.alterTable('obama_vital_audits', (t) => {
      t.string('source', 10).notNullable().defaultTo('aware').after('uniqueid');
      t.string('audio_url', 500).nullable().after('audiofile');
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.alterTable('obama_vital_audits', (t) => {
    t.dropColumn('source');
    t.dropColumn('audio_url');
  });
};
