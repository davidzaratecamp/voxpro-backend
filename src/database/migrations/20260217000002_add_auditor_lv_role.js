/**
 * Agrega el rol auditor_lv al enum de roles de usuario.
 */

exports.up = async function (knex) {
  await knex.raw(
    "ALTER TABLE users MODIFY COLUMN role ENUM('auditor_obama', 'auditor_claro', 'auditor_lv', 'admin') NOT NULL"
  );
};

exports.down = async function (knex) {
  await knex.raw(
    "ALTER TABLE users MODIFY COLUMN role ENUM('auditor_obama', 'auditor_claro', 'admin') NOT NULL"
  );
};
