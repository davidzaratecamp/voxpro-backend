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
 *
 * Resolución de identidad (sin intervención manual):
 *   1. Al insertar: busca extensión en tabla `agents` (cedula ya conocida).
 *   2. Si no está: intenta auto-match fuzzy por nombre contra Aware.
 *   3. Si tampoco: guarda el agente con cedula=NULL para reintento futuro.
 *   4. Al final de cada scan: `resolveUnmatchedAgents()` reintenta todos los
 *      agentes pendientes — cuando aparezcan en Aware se resuelven solos.
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
      .select('s.id', 's.client_id', 'c.code as client_code')
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
        const result = await this._insertRecording(rec, source);
        if (result === 'inserted') summary.inserted++;
        else summary.skipped++;
      } catch (err) {
        logger.error(`Zoom: error insertando recording ${rec.id}`, err);
        summary.errors++;
      }
    }

    // Al final de cada scan, reintentar agentes que aún no tienen cédula.
    // Cuando aparezcan en Aware, se resuelven solos en el siguiente ciclo.
    const resolved = await this.resolveUnmatchedAgents();
    if (resolved.resolved > 0) {
      logger.info(`Zoom: resueltos ${resolved.resolved}/${resolved.checked} agentes pendientes`);
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
   *
   * Resolución de identidad del agente (en orden):
   *   1. Tabla `agents` por zoom_extension → cédula conocida
   *   2. Auto-match fuzzy por nombre contra grabaciones Aware
   *   3. Fallback: extensión como agent_id + guarda en agents con cedula=NULL
   *      para que resolveUnmatchedAgents() lo reintente en el futuro.
   */
  async _insertRecording(rec, source) {
    if (!rec.download_url) return 'skipped';

    const pathHash = crypto.createHash('sha256').update(rec.download_url).digest('hex');

    const existing = await db('recordings').where('file_path_hash', pathHash).first();
    if (existing) return 'skipped';

    // Número externo (del cliente): inbound → caller, outbound → callee
    const callPhone = rec.direction === 'inbound'
      ? (rec.caller_number || null)
      : (rec.callee_number || null);

    // Fecha local de la llamada (la API devuelve UTC en date_time, usamos la parte de fecha)
    const fileDate = (rec.date_time || rec.start_time || null)?.slice(0, 10) ?? null;

    const agentExt  = rec.owner?.extension_number ? String(rec.owner.extension_number) : null;
    const zoomName  = rec.owner?.name || null;

    let agentId   = agentExt || rec.owner?.id || null;
    let agentName = zoomName;

    if (agentExt) {
      // 1. Lookup en tabla agents (mapping ya conocido)
      const agentRow = await db('agents')
        .where('zoom_extension', agentExt)
        .whereNotNull('cedula')
        .first();

      if (agentRow) {
        agentId   = agentRow.cedula;
        agentName = agentRow.name;
      } else if (zoomName) {
        // 2. Auto-match fuzzy contra grabaciones Aware
        const matched = await this._autoMatchAgent(agentExt, zoomName, source.client_id);
        if (matched) {
          agentId   = matched.cedula;
          agentName = matched.name;
        } else {
          // 3. Sin match aún: guardar en agents con cedula=NULL para reintento futuro
          await db('agents')
            .insert({
              name:           zoomName,
              cedula:         null,
              zoom_extension: agentExt,
              client_id:      source.client_id,
              active:         true,
            })
            .onConflict('zoom_extension')
            .ignore();
        }
      }
    }

    await db('recordings').insert({
      aware_source_id:  source.id,
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

  /**
   * Reintenta resolver la cédula de todos los agentes Zoom sin cédula.
   * Se llama al final de cada scan. Cuando el agente aparezca en Aware
   * (aunque sea días después), en el siguiente scan queda resuelto y sus
   * grabaciones existentes se actualizan en masa.
   */
  async resolveUnmatchedAgents() {
    const unmatched = await db('agents')
      .whereNull('cedula')
      .whereNotNull('zoom_extension')
      .whereNotNull('name')
      .select('id', 'name', 'zoom_extension', 'client_id');

    let resolved = 0;

    for (const agent of unmatched) {
      const matched = await this._autoMatchAgent(agent.zoom_extension, agent.name, agent.client_id);
      if (!matched) continue;

      // Actualizar en masa todas las grabaciones Zoom de esta extensión
      await db('recordings')
        .where('agent_extension', agent.zoom_extension)
        .where('agent_id', agent.zoom_extension) // solo las que quedaron sin cédula
        .update({ agent_id: matched.cedula, agent_name: matched.name });

      resolved++;
    }

    return { checked: unmatched.length, resolved };
  }

  /**
   * Intenta resolver la cédula de un agente Zoom buscando su nombre en las
   * grabaciones Aware del mismo cliente mediante coincidencia difusa de tokens.
   *
   * Si encuentra un candidato confiable (≥2 tokens en común, score ≥ 0.5),
   * guarda el mapeo en la tabla `agents` para futuras grabaciones.
   *
   * @param {string} extension - Extensión Zoom del agente
   * @param {string} zoomName  - Nombre completo tal como viene de la API Zoom
   * @param {number} clientId  - client_id de la fuente Zoom
   * @returns {{ cedula: string, name: string } | null}
   */
  async _autoMatchAgent(extension, zoomName, clientId) {
    const normalize = (str) =>
      str
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, '');

    const splitCamel = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2');
    const tokens = normalize(splitCamel(zoomName))
      .split(/\s+/)
      .filter((t) => t.length > 2);

    if (tokens.length === 0) return null;

    // Candidatos: agentes distintos en todas las grabaciones Aware (cualquier cliente)
    const candidates = await db('recordings as r')
      .join('aware_sources as s', 'r.aware_source_id', 's.id')
      .where('s.source_type', '!=', 'zoom')
      .whereNotNull('r.agent_id')
      .whereNotNull('r.agent_name')
      .distinct('r.agent_id', 'r.agent_name')
      .limit(2000);

    let best        = null;
    let bestScore   = 0;
    let bestOverlap = 0;

    for (const c of candidates) {
      const candTokens = normalize(splitCamel(c.agent_name))
        .split(/\s+/)
        .filter((t) => t.length > 2);

      const overlap = tokens.filter((t) => candTokens.includes(t)).length;
      const score   = overlap / Math.max(tokens.length, candTokens.length);

      if (overlap >= 2 && score >= 0.5 && score > bestScore) {
        bestScore   = score;
        bestOverlap = overlap;
        best        = c;
      }
    }

    if (!best) return null;

    // Persistir el mapeo para no repetir la búsqueda en el futuro
    try {
      await db('agents')
        .insert({
          name:           best.agent_name,
          cedula:         best.agent_id,
          zoom_extension: extension,
          client_id:      clientId,
          active:         true,
        })
        .onConflict('zoom_extension')
        .merge(['cedula', 'name']);

      logger.info(
        `Zoom: auto-matched "${zoomName}" → ${best.agent_id} (${best.agent_name}) ` +
        `[overlap=${bestOverlap}, score=${bestScore.toFixed(2)}]`
      );
    } catch (err) {
      logger.warn(`Zoom: no se pudo guardar auto-match para extensión ${extension}: ${err.message}`);
    }

    return { cedula: best.agent_id, name: best.agent_name };
  }

  _yesterday() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }
}

module.exports = new ZoomScannerService();
