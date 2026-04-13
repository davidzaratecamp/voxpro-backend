const crypto   = require('crypto');
const db        = require('../database/connection');
const ZoomAuth  = require('./ZoomAuthService');
const logger    = require('../utils/logger');

/**
 * Escanea grabaciones de Zoom Phone e inserta en la tabla recordings.
 *
 * Equivalente a ScannerService pero usa la API REST de Zoom en lugar de SFTP.
 * Los metadatos del agente vienen incluidos en la respuesta — no necesita
 * fase de enriquecimiento separada (agent_enriched = true desde el inicio).
 */
class ZoomScannerService {
  /**
   * Escanea las grabaciones de un día específico.
   * @param {object} options
   * @param {string} [options.targetDate] - Fecha YYYY-MM-DD (default: ayer)
   */
  async run({ targetDate } = {}) {
    const date = targetDate || this._yesterday();

    // Obtener la fuente ZOOM_PHONE de Obama
    const source = await db('aware_sources as s')
      .join('clients as c', 's.client_id', 'c.id')
      .where('s.folder_name', 'ZOOM_PHONE')
      .where('s.source_type', 'zoom')
      .where('s.active', true)
      .select('s.id', 'c.code as client_code')
      .first();

    if (!source) {
      logger.warn('Zoom: fuente ZOOM_PHONE no encontrada o inactiva');
      return { found: 0, inserted: 0, skipped: 0, errors: 0 };
    }

    logger.info(`Zoom: escaneando ${date}`);

    let recordings;
    try {
      recordings = await this._listRecordings(date);
    } catch (err) {
      logger.error('Zoom: error listando grabaciones', err);
      return { found: 0, inserted: 0, skipped: 0, errors: 1 };
    }

    logger.info(`Zoom: ${recordings.length} grabaciones encontradas para ${date}`);

    const summary = { found: recordings.length, inserted: 0, skipped: 0, errors: 0 };

    for (const rec of recordings) {
      try {
        const result = await this._insertRecording(rec, source.id);
        if (result === 'inserted') summary.inserted++;
        else summary.skipped++;
      } catch (err) {
        logger.error(`Zoom: error insertando recording ${rec.id}`, err);
        summary.errors++;
      }
    }

    logger.info('Zoom: scan completado', summary);
    return summary;
  }

  /**
   * Lista todas las grabaciones de una fecha paginando automáticamente.
   */
  async _listRecordings(date) {
    const recordings  = [];
    let nextPageToken = null;

    do {
      const params = { from: date, to: date, page_size: 100 };
      if (nextPageToken) params.next_page_token = nextPageToken;

      const data = await ZoomAuth.get('/phone/recordings', params);

      if (Array.isArray(data.recordings)) {
        recordings.push(...data.recordings);
      }

      nextPageToken = data.next_page_token || null;
    } while (nextPageToken);

    return recordings;
  }

  /**
   * Inserta una grabación de Zoom en la tabla recordings.
   * Usa download_url como identificador estable (necesita auth para descargar).
   * Si el agente está en la tabla agents con cédula, usa la cédula como agent_id
   * para que los filtros de coordinador/formador funcionen igual que con Aware.
   */
  async _insertRecording(rec, sourceId) {
    if (!rec.download_url) return 'skipped';

    const pathHash = crypto.createHash('sha256').update(rec.download_url).digest('hex');

    const existing = await db('recordings').where('file_path_hash', pathHash).first();
    if (existing) return 'skipped';

    // Número externo (del cliente): inbound → caller, outbound → callee
    const callPhone = rec.direction === 'inbound'
      ? (rec.caller_number || null)
      : (rec.callee_number || null);

    // Fecha local de la llamada (la API devuelve UTC, usamos la parte de fecha)
    const fileDate = rec.start_time ? rec.start_time.slice(0, 10) : null;

    const agentExt = rec.owner?.extension_number ? String(rec.owner.extension_number) : null;

    // Buscar cédula en tabla agents para unificar identidad con grabaciones Aware
    let agentId = agentExt || rec.owner?.id || null;
    let agentName = rec.owner?.name || null;
    if (agentExt) {
      const agentRow = await db('agents').where('zoom_extension', agentExt).whereNotNull('cedula').first();
      if (agentRow) {
        agentId   = agentRow.cedula;
        agentName = agentRow.name;
      }
    }

    await db('recordings').insert({
      aware_source_id:  sourceId,
      file_name:        `${rec.id}.mp4`,
      file_path:        rec.download_url,
      file_path_hash:   pathHash,
      file_size:        rec.file_size || null,
      file_date:        fileDate,
      call_phone:       callPhone,
      call_id:          rec.id,
      is_queue_call:    false,
      agent_id:         agentId,
      agent_name:       agentName,
      agent_extension:  agentExt,
      call_duration:    rec.duration || null,
      agent_enriched:   true,
      status:           'pending',
    });

    return 'inserted';
  }

  _yesterday() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }
}

module.exports = new ZoomScannerService();
