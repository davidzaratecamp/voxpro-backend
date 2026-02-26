const AWARE_SOURCES = require('../../config/sources');

exports.seed = async function (knex) {
  // Extraer clientes únicos del mapeo
  const clientMap = {};
  for (const source of AWARE_SOURCES) {
    if (!clientMap[source.clientCode]) {
      clientMap[source.clientCode] = source.clientName;
    }
  }

  // Insertar clientes (ignorar si ya existen)
  for (const [code, name] of Object.entries(clientMap)) {
    const exists = await knex('clients').where({ code }).first();
    if (!exists) {
      await knex('clients').insert({ code, name, active: true });
    }
  }

  // Insertar cliente LV (comparte AWARE_30 con Obama, se separa por proyecto_id)
  const lvExists = await knex('clients').where({ code: 'lv' }).first();
  if (!lvExists) {
    await knex('clients').insert({ code: 'lv', name: 'LV (Vital Health)', active: true });
  }

  // Insertar fuentes Aware
  for (const source of AWARE_SOURCES) {
    const client = await knex('clients').where({ code: source.clientCode }).first();
    const exists = await knex('aware_sources').where({ folder_name: source.folder }).first();
    if (!exists) {
      await knex('aware_sources').insert({
        client_id: client.id,
        folder_name: source.folder,
        active: true,
      });
    }
  }
};
