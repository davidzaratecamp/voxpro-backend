/**
 * Limpia la tabla `agents` y le pone la restricción que el código siempre
 * asumió (oct-2026).
 *
 * ZoomScannerService inserta con `.onConflict('zoom_extension')`, pero la tabla
 * nunca tuvo un índice ÚNICO en zoom_extension: MySQL no detectaba conflicto y
 * cada grabación de Zoom agregaba otra fila. Llegó a ~8 millones de filas para
 * 156 extensiones (+100–300 mil por día), y las consultas sobre ella dejaron
 * pantallas cargando.
 *
 * Cómo se hace (sin borrar datos):
 *  1. Tabla nueva `agents_dedup` con UNIQUE(zoom_extension).
 *  2. Se copia: todas las filas sin extensión, y por extensión UNA fila — la
 *     de menor id con cédula (es exactamente la que hoy devuelve
 *     `.where(zoom_extension).whereNotNull(cedula).first()`), o la de menor id
 *     si ninguna tiene cédula. Así el escaneo resuelve igual que antes.
 *  3. RENAME atómico: `agents` → `agents_backup_20261015`, `agents_dedup` →
 *     `agents`. La tabla vieja queda como respaldo (borrarla después, a mano,
 *     libera ~1 GB).
 *
 * Idempotente: si `agents` ya tiene el índice único, no hace nada.
 */

const BACKUP = 'agents_backup_20261015';
const UNIQUE = 'agents_zoom_extension_unique';
const FK = 'agents_client_id_foreign';

async function hasUnique(knex) {
  const [rows] = await knex.raw(`SHOW INDEX FROM agents WHERE Key_name = ?`, [UNIQUE]);
  return rows.length > 0;
}

exports.up = async function (knex) {
  if (await hasUnique(knex)) return;

  await knex.raw('SET SESSION MAX_EXECUTION_TIME = 0');
  const [[{ maxId }]] = await knex.raw('SELECT COALESCE(MAX(id), 0) AS maxId FROM agents');

  await knex.raw('DROP TABLE IF EXISTS agents_dedup');
  await knex.raw('CREATE TABLE agents_dedup LIKE agents');
  await knex.raw('ALTER TABLE agents_dedup DROP INDEX agents_zoom_extension_index');
  await knex.raw(`ALTER TABLE agents_dedup ADD UNIQUE KEY ${UNIQUE} (zoom_extension)`);

  await knex.raw('INSERT INTO agents_dedup SELECT * FROM agents WHERE zoom_extension IS NULL AND id <= ?', [maxId]);
  await knex.raw(`
    INSERT INTO agents_dedup
    SELECT a.* FROM agents a
    JOIN (
      SELECT zoom_extension, COALESCE(MIN(CASE WHEN cedula IS NOT NULL THEN id END), MIN(id)) AS keep_id
      FROM agents WHERE zoom_extension IS NOT NULL AND id <= ?
      GROUP BY zoom_extension
    ) k ON k.keep_id = a.id`, [maxId]);

  // Lo que el escaneo haya insertado mientras se copiaba (extensiones nuevas).
  await knex.raw(`
    INSERT IGNORE INTO agents_dedup
    SELECT * FROM agents WHERE id > ? ORDER BY (cedula IS NULL), id`, [maxId]);

  await knex.raw(`RENAME TABLE agents TO ${BACKUP}, agents_dedup TO agents`);

  // Los nombres de FK son únicos por base: se le quita a la copia de respaldo
  // y se crea en la tabla nueva con el nombre original.
  await knex.raw(`ALTER TABLE ${BACKUP} DROP FOREIGN KEY ${FK}`);
  await knex.raw(`ALTER TABLE agents ADD CONSTRAINT ${FK} FOREIGN KEY (client_id) REFERENCES clients (id)`);
};

exports.down = async function (knex) {
  const [rows] = await knex.raw(`SHOW TABLES LIKE ?`, [BACKUP]);
  if (!rows.length) return;
  await knex.raw(`ALTER TABLE agents DROP FOREIGN KEY ${FK}`);
  await knex.raw(`RENAME TABLE agents TO agents_dedup_rollback, ${BACKUP} TO agents`);
  await knex.raw(`ALTER TABLE agents ADD CONSTRAINT ${FK} FOREIGN KEY (client_id) REFERENCES clients (id)`);
  await knex.raw('DROP TABLE agents_dedup_rollback');
};
