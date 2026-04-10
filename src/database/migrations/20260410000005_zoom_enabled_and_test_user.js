const bcrypt = require('bcrypt');

/**
 * Agrega zoom_enabled a users (feature flag para grabaciones Zoom).
 * Crea usuario de prueba obamazoom con acceso a Zoom + Obama.
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('users', (table) => {
    table.boolean('zoom_enabled').notNullable().defaultTo(false).after('active');
  });

  const passwordHash = await bcrypt.hash('obamazoom', 10);

  await knex('users').insert({
    username:      'obamazoom',
    password_hash: passwordHash,
    name:          'Obama Zoom Test',
    role:          'supervisor_calidad',
    client_codes:  JSON.stringify(['obama']),
    active:        true,
    zoom_enabled:  true,
  });
};

exports.down = async (knex) => {
  await knex('users').where('username', 'obamazoom').delete();
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('zoom_enabled');
  });
};
