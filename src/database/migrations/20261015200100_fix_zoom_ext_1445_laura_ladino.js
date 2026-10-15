/**
 * Corrige la extensión de Zoom 1445: es de Laura Ladino (cédula 1034399515).
 * Verificado contra la API de Zoom el 15-oct-2026: las 543 grabaciones con esa
 * extensión tienen como dueño "Laura Ladino [ext 1445]". El reconocimiento de
 * nombres anterior del escaneo de Obama (solo 2 palabras en común) la asoció a
 * Laura Perea (1020717016, que tiene su propia extensión, la 1370).
 *
 * Solo actúa si el dato equivocado sigue igual. Las grabaciones que cambia
 * quedan en `recordings_fix_1445_backup` para poder revertir exactamente. No
 * toca auditorías (ninguna de esas grabaciones tenía).
 */

const EXT = '1445';
const WRONG = { cedula: '1020717016', name: 'Laura Valentina Perea Avendaño' };
const RIGHT = { cedula: '1034399515', name: 'Ladino Quintero Laura Valentina' };
const BACKUP = 'recordings_fix_1445_backup';

exports.up = async function (knex) {
  const row = await knex('agents').where('zoom_extension', EXT).first('id', 'cedula');
  if (!row || row.cedula !== WRONG.cedula) return;

  if (!(await knex.schema.hasTable(BACKUP))) {
    await knex.schema.createTable(BACKUP, (t) => {
      t.integer('recording_id').unsigned().primary();
      t.string('old_agent_id', 50);
      t.string('old_agent_name', 255);
    });
  }
  await knex.raw(
    `INSERT IGNORE INTO ${BACKUP} (recording_id, old_agent_id, old_agent_name)
     SELECT id, agent_id, agent_name FROM recordings WHERE agent_extension = ? AND agent_id = ?`,
    [EXT, WRONG.cedula]
  );
  await knex('recordings')
    .whereIn('id', knex(BACKUP).select('recording_id'))
    .update({ agent_id: RIGHT.cedula, agent_name: RIGHT.name });
  await knex('agents').where('zoom_extension', EXT).update({ cedula: RIGHT.cedula, name: RIGHT.name, updated_at: knex.fn.now() });
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable(BACKUP))) return;
  await knex.raw(
    `UPDATE recordings r JOIN ${BACKUP} b ON b.recording_id = r.id
     SET r.agent_id = b.old_agent_id, r.agent_name = b.old_agent_name`
  );
  await knex('agents').where('zoom_extension', EXT).update({ cedula: WRONG.cedula, name: WRONG.name });
  await knex.schema.dropTable(BACKUP);
};
