/**
 * Agrega fuente ZOOM_PHONE_LV para LV (Vital Health) y migra las
 * grabaciones Zoom de agentes LV que estaban atribuidas a Obama.
 *
 * Los agentes LV se identifican por su cédula: son aquellos que tienen
 * grabaciones en Aware con proyecto_id IN (34=LV-Ventas, 35=LV-Customer).
 */

const LV_PROYECTO_IDS = [34, 35];

exports.up = async (knex) => {
  // 1. Obtener client_id de LV
  const lvClient = await knex('clients').where('code', 'lv').select('id').first();
  if (!lvClient) {
    console.warn('Migration: cliente LV no encontrado, omitiendo.');
    return;
  }

  // 2. Insertar fuente ZOOM_PHONE_LV (solo si no existe ya)
  const existing = await knex('aware_sources').where('folder_name', 'ZOOM_PHONE_LV').first();
  if (!existing) {
    await knex('aware_sources').insert({
      client_id:   lvClient.id,
      folder_name: 'ZOOM_PHONE_LV',
      source_type: 'zoom',
      active:      true,
    });
  }

  // 3. Obtener IDs de ambas fuentes Zoom
  const lvZoomSource    = await knex('aware_sources').where('folder_name', 'ZOOM_PHONE_LV').first();
  const obamaZoomSource = await knex('aware_sources').where('folder_name', 'ZOOM_PHONE').first();

  if (!lvZoomSource || !obamaZoomSource) {
    console.warn('Migration: no se encontraron las fuentes Zoom necesarias.');
    return;
  }

  // 4. Obtener cédulas de agentes LV desde sus grabaciones Aware
  const lvAgents = await knex('recordings')
    .whereIn('proyecto_id', LV_PROYECTO_IDS)
    .whereNotNull('agent_id')
    .distinct('agent_id')
    .select('agent_id');

  const lvCedulas = lvAgents.map((a) => a.agent_id);

  if (lvCedulas.length === 0) {
    console.log('Migration: no se encontraron agentes LV, nada que migrar.');
    return;
  }

  // 5. Reasignar grabaciones Zoom de agentes LV a la nueva fuente
  const updated = await knex('recordings')
    .where('aware_source_id', obamaZoomSource.id)
    .whereIn('agent_id', lvCedulas)
    .update({ aware_source_id: lvZoomSource.id });

  console.log(`Migration: ${updated} grabaciones Zoom reasignadas de Obama → LV.`);
};

exports.down = async (knex) => {
  const obamaZoomSource = await knex('aware_sources').where('folder_name', 'ZOOM_PHONE').first();
  const lvZoomSource    = await knex('aware_sources').where('folder_name', 'ZOOM_PHONE_LV').first();

  if (obamaZoomSource && lvZoomSource) {
    await knex('recordings')
      .where('aware_source_id', lvZoomSource.id)
      .update({ aware_source_id: obamaZoomSource.id });
  }

  await knex('aware_sources').where('folder_name', 'ZOOM_PHONE_LV').delete();
};
