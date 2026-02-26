const bcrypt = require('bcrypt');

/**
 * @param { import("knex").Knex } knex
 */
exports.seed = async function (knex) {
  const hash = await bcrypt.hash('password', 10);

  const users = [
    {
      username: 'obama_quality',
      password_hash: hash,
      name: 'Auditor Obama',
      role: 'auditor_obama',
      client_codes: JSON.stringify(['obama']),
      active: true,
    },
    {
      username: 'lv_quality',
      password_hash: hash,
      name: 'Auditor LV',
      role: 'auditor_lv',
      client_codes: JSON.stringify(['lv']),
      active: true,
    },
    {
      username: 'claro_quality',
      password_hash: hash,
      name: 'Auditor Claro',
      role: 'auditor_claro',
      client_codes: JSON.stringify(['claro_tyt', 'claro_hogar', 'claro_wcb']),
      active: true,
    },
  ];

  for (const user of users) {
    const exists = await knex('users').where('username', user.username).first();
    if (!exists) {
      await knex('users').insert(user);
    }
  }
};
