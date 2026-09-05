const crypto = require('crypto');
const XLSX = require('xlsx');
const { Client: PGClient } = require('pg');
const db = require('../database/connection');
const logger = require('../utils/logger');
const AWARE_SOURCES = require('../config/sources');
const RealtimeScanService = require('./RealtimeScanService');
const AnalysisService = require('./AnalysisService');

const { openTunnel, buildStandardAudioUrl } = RealtimeScanService;

const SOURCE = AWARE_SOURCES.find((s) => s.folder === 'AWARE_4' && s.clientCode === 'claro_hogar');
const CLIENT_CODE = 'claro_hogar';
const MATCH_BATCH_SIZE = 20;
const ANALYZE_CONCURRENCY = 5;

/**
 * mysql2 devuelve columnas DATE como objetos Date (medianoche hora local del
 * servidor), no strings — hay que normalizar antes de usarlas como 'YYYY-MM-DD'
 * (para el query a Postgres o para cálculos de fecha), igual que
 * VoicebotService._mapRow lo hace para las columnas `fecha` que vienen de pg.
 */
function toDateStr(val) {
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(val).slice(0, 10);
}

/** Mismo cálculo de semana ISO (lunes-domingo) que usan realtime.controller.js / AuditService. */
function getWeekBounds(dateStr) {
  const [y, m, d] = toDateStr(dateStr).split('-').map(Number);
  const ref = new Date(Date.UTC(y, m - 1, d));
  const day = ref.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(ref);
  monday.setUTCDate(ref.getUTCDate() - diff);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    weekStart: monday.toISOString().slice(0, 10),
    weekEnd: sunday.toISOString().slice(0, 10),
  };
}

class SantiService {
  async _getAwareSourceId() {
    const row = await db('aware_sources as s')
      .join('clients as c', 's.client_id', 'c.id')
      .where('c.code', CLIENT_CODE)
      .andWhere('s.folder_name', SOURCE.folder)
      .select('s.id')
      .first();
    if (!row) throw new Error(`No existe aware_sources para ${SOURCE.folder}/${CLIENT_CODE}`);
    return row.id;
  }

  /**
   * Importa un Excel de campaña outbound (ej. P21 BOX PRO) — una fila por
   * teléfono a auditar. Columnas esperadas (headers exactos del Excel):
   * Fecha_Llegada, Min (teléfono), Ciudad, DivisionComercial, NombreCampaña,
   * AliadoAsignado, Campaña, Tipo_Contacto, claro_detalle,
   * codigo_claro_tipificacion, Duracion_Llamada, Agente_Id, Intentos.
   *
   * Deduplica contra CUALQUIER importación anterior por teléfono+fecha exacta
   * — si el mismo Excel se sube dos veces, o dos campañas comparten un
   * teléfono+fecha, no se vuelve a auditar.
   */
  async importFromExcel(buffer, originalName) {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    const importBatch = `${originalName.replace(/\.[^.]+$/, '')}_${Date.now()}`;

    const candidates = [];
    for (const raw of rows) {
      const r = {};
      for (const k of Object.keys(raw)) r[k.trim()] = raw[k];

      const phone = String(r['Min'] ?? '').trim();
      if (!phone) continue;

      const fechaRaw = r['Fecha_Llegada'];
      const fecha = fechaRaw instanceof Date
        ? fechaRaw.toISOString().slice(0, 10)
        : String(fechaRaw || '').slice(0, 10);
      if (!fecha || fecha === 'null') continue;

      candidates.push({
        import_batch: importBatch,
        phone,
        fecha_excel: fecha,
        ciudad: r['Ciudad'] || null,
        division_comercial: r['DivisionComercial'] || null,
        nombre_campana: r['NombreCampaña'] || null,
        aliado_asignado: r['AliadoAsignado'] || null,
        campana: r['Campaña'] || null,
        tipo_contacto: r['Tipo_Contacto'] || null,
        claro_detalle: r['claro_detalle'] || null,
        codigo_claro_tipificacion: r['codigo_claro_tipificacion'] != null ? String(r['codigo_claro_tipificacion']) : null,
        duracion_excel: Number.isFinite(r['Duracion_Llamada']) ? r['Duracion_Llamada'] : null,
        agente_id_excel: r['Agente_Id'] != null ? String(r['Agente_Id']) : null,
        intentos_excel: Number.isFinite(r['Intentos']) ? r['Intentos'] : null,
        excel_raw: JSON.stringify(r),
        status: 'pending',
      });
    }

    const existingKeys = new Set(
      (await db('santi_audits').select('phone', 'fecha_excel'))
        .map((row) => `${row.phone}::${String(row.fecha_excel).slice(0, 10)}`)
    );
    const fresh = candidates.filter((c) => !existingKeys.has(`${c.phone}::${c.fecha_excel}`));

    if (fresh.length) await db('santi_audits').insert(fresh);

    logger.info(`Santi: importadas ${fresh.length}/${rows.length} filas (batch ${importBatch})`);
    return {
      totalFilas: rows.length,
      importadas: fresh.length,
      omitidasPorDuplicado: candidates.length - fresh.length,
      sinTelefonoOFecha: rows.length - candidates.length,
      importBatch,
    };
  }

  async getSummary() {
    const rows = await db('santi_audits').select('status').count('* as count').groupBy('status');
    const summary = { pending: 0, matched: 0, not_found: 0, done: 0, error: 0, total: 0 };
    for (const r of rows) {
      summary[r.status] = Number(r.count);
      summary.total += Number(r.count);
    }
    return summary;
  }

  _baseQuery() {
    return db('santi_audits as sa')
      .leftJoin('audit_selections as sel', 'sa.selection_id', 'sel.id')
      .leftJoin('transcriptions as tr', 'sa.recording_id', 'tr.recording_id');
  }

  async list({ status, phone, page = 1, pageSize = 50 } = {}) {
    const cols = [
      'sa.id', 'sa.phone', 'sa.fecha_excel', 'sa.ciudad', 'sa.campana', 'sa.claro_detalle',
      'sa.status', 'sa.error_message',
      'sel.agent_id', 'sel.agent_name', 'sel.score', 'sel.notes as summary',
      'tr.transcript_text as transcription',
    ];
    let query = this._baseQuery().select(cols).orderBy('sa.id', 'desc');
    if (status) query = query.where('sa.status', status);
    if (phone) query = query.where('sa.phone', 'like', `%${phone}%`);

    const countRow = await query.clone().clearSelect().clearOrder().count('sa.id as count').first();
    const data = await query.limit(pageSize).offset((page - 1) * pageSize);
    return { data, total: Number(countRow.count), page, pageSize };
  }

  /** Igual que list() pero sin paginar — para el export a Excel. */
  async exportRows({ status, phone } = {}) {
    const cols = [
      'sa.phone', 'sa.fecha_excel', 'sa.ciudad', 'sa.campana', 'sa.claro_detalle', 'sa.status',
      'sel.agent_id', 'sel.agent_name', 'sel.score', 'sel.notes as summary',
      'tr.transcript_text as transcription',
    ];
    let query = this._baseQuery().select(cols).orderBy('sa.id');
    if (status) query = query.where('sa.status', status);
    if (phone) query = query.where('sa.phone', 'like', `%${phone}%`);
    return query;
  }

  /**
   * Procesa un lote de filas pendientes: abre UN túnel/conexión a AWARE_4
   * (Claro Hogar) por corrida, busca cada teléfono+fecha, y para las que
   * encuentra crea el recording+selection y dispara el mismo análisis de IA
   * que usan las auditorías manuales (AnalysisService.analyzeSelection) —
   * reutiliza 100% la descarga (túnel SSH / SFTP Kraken) y el scoring contra
   * la matriz de calidad real de claro_hogar, sin duplicar esa lógica.
   */
  async processPendingBatch(limit = MATCH_BATCH_SIZE) {
    const pending = await db('santi_audits').where('status', 'pending').orderBy('id').limit(limit);
    if (!pending.length) return { processed: 0, matched: 0 };

    const awareSourceId = await this._getAwareSourceId();

    let tunnel = null;
    let pgClient = null;
    const matched = [];
    try {
      tunnel = await openTunnel(SOURCE.db.host, SOURCE.db.port);
      pgClient = new PGClient({
        host: '127.0.0.1',
        port: tunnel.port,
        database: SOURCE.db.database,
        user: SOURCE.db.user,
        password: SOURCE.db.password,
        statement_timeout: 20000,
      });
      await pgClient.connect();

      for (const row of pending) {
        try {
          const fechaStr = toDateStr(row.fecha_excel);
          const result = await pgClient.query(
            `SELECT rl.registro_llamada_id, rl.agente_id::text AS agent_id, e.empleado_name AS agent_name,
                    rl.call_time AS duration, rl.registro_llamada_fecha AS file_date,
                    rl.proyecto_id, rl.call_id
             FROM registro_llamada rl
             LEFT JOIN empleado e ON rl.agente_id = e.empleado_rut
             WHERE rl.registro_llamada_fono = $1 AND rl.registro_llamada_fecha = $2::date
               AND rl.call_time > 0 AND rl.call_id > 0
             ORDER BY rl.registro_llamada_id DESC
             LIMIT 1`,
            [row.phone, fechaStr]
          );
          const hit = result.rows[0];
          if (!hit) {
            await db('santi_audits').where('id', row.id).update({ status: 'not_found' });
            continue;
          }
          if (!hit.agent_id) {
            await db('santi_audits').where('id', row.id).update({ status: 'error', error_message: 'Llamada encontrada sin agente asignado' });
            continue;
          }
          matched.push({ row, hit });
        } catch (err) {
          logger.error(`Santi: error buscando ${row.phone}/${row.fecha_excel}`, err);
          await db('santi_audits').where('id', row.id).update({ status: 'error', error_message: err.message?.slice(0, 500) || 'error de consulta' });
        }
      }
    } catch (err) {
      logger.error('Santi: error abriendo túnel/conexión a AWARE_4', err);
      return { processed: 0, matched: 0, tunnelError: err.message };
    } finally {
      if (pgClient) await pgClient.end().catch(() => {});
      if (tunnel) { try { tunnel.server.close(); } catch {} try { tunnel.sshClient.end(); } catch {} }
    }

    for (let i = 0; i < matched.length; i += ANALYZE_CONCURRENCY) {
      const chunk = matched.slice(i, i + ANALYZE_CONCURRENCY);
      await Promise.allSettled(chunk.map((m) => this._createAndAnalyze(m.row, m.hit, awareSourceId)));
    }

    return { processed: pending.length, matched: matched.length };
  }

  async _createAndAnalyze(row, hit, awareSourceId) {
    try {
      const audioUrl = buildStandardAudioUrl(SOURCE.audioBaseUrl, hit.file_date, row.phone, hit.call_id);
      const pathHash = crypto.createHash('sha256').update(audioUrl).digest('hex');

      let recordingId;
      const existingRecording = await db('recordings').where('file_path_hash', pathHash).first();
      if (existingRecording) {
        recordingId = existingRecording.id;
      } else {
        [recordingId] = await db('recordings').insert({
          aware_source_id: awareSourceId,
          file_name: audioUrl.split('/').pop(),
          file_path: audioUrl,
          file_path_hash: pathHash,
          file_date: toDateStr(row.fecha_excel),
          agent_id: hit.agent_id,
          agent_name: hit.agent_name,
          call_duration: hit.duration,
          call_phone: row.phone,
          call_id: String(hit.call_id),
          proyecto_id: hit.proyecto_id,
          agent_enriched: true,
          status: 'pending',
        });
      }

      let selectionId;
      const existingSelection = await db('audit_selections').where('recording_id', recordingId).first();
      if (existingSelection) {
        selectionId = existingSelection.id;
      } else {
        const { weekStart, weekEnd } = getWeekBounds(row.fecha_excel);
        [selectionId] = await db('audit_selections').insert({
          recording_id: recordingId,
          agent_id: hit.agent_id,
          agent_name: hit.agent_name,
          client_code: CLIENT_CODE,
          week_start: weekStart,
          week_end: weekEnd,
          status: 'selected',
          score: 0,
        });
      }

      await db('santi_audits').where('id', row.id).update({ status: 'matched', recording_id: recordingId, selection_id: selectionId });

      await AnalysisService.analyzeSelection(selectionId);

      await db('santi_audits').where('id', row.id).update({ status: 'done' });
    } catch (err) {
      logger.error(`Santi: falló auditoría de fila ${row.id} (${row.phone})`, err);
      await db('santi_audits').where('id', row.id).update({ status: 'error', error_message: err.message?.slice(0, 500) || 'error desconocido' });
    }
  }
}

module.exports = new SantiService();
