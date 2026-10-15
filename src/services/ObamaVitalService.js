const { execFile } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { Client: PGClient } = require('pg');
const source = require('../config/obamaVitalSource');
const logger = require('../utils/logger');
const db = require('../database/connection');
const GeminiService = require('./GeminiService');
const CriteriaService = require('./CriteriaService');
const { downloadBuffer } = require('./RealtimeScanService');
const ZoomAuth = require('./ZoomAuthService');
const { bestNameMatch } = require('../utils/nameMatch');

const execFileAsync = promisify(execFile);

// proyecto_id → { campaign, key, proyectoName }
const PROYECTO_MAP = new Map();
for (const [campaign, cfg] of Object.entries(source.campaigns)) {
  for (const [id, name] of Object.entries(cfg.proyectos)) {
    PROYECTO_MAP.set(Number(id), { campaign, key: cfg.key, proyectoName: name });
  }
}
const ALL_PROYECTO_IDS = [...PROYECTO_MAP.keys()];

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/** Archivos temporales con nombre único — varias conversiones pueden correr a la vez. */
function tmpFile(prefix, ext) {
  return path.join(os.tmpdir(), `${prefix}_${crypto.randomUUID()}.${ext}`);
}

async function convertAudio(rawBuffer, ffmpegArgs, outExt) {
  const tmpInput = tmpFile('obama_vital_in', 'wav');
  const tmpOutput = tmpFile('obama_vital_out', outExt);
  try {
    fs.writeFileSync(tmpInput, rawBuffer);
    await execFileAsync('ffmpeg', ['-y', '-i', tmpInput, ...ffmpegArgs, tmpOutput]);
    return fs.readFileSync(tmpOutput);
  } finally {
    fs.unlink(tmpInput, () => {});
    fs.unlink(tmpOutput, () => {});
  }
}

/**
 * Fuente de llamadas: los registros de la central (cdr_custom), NO solo
 * registro_llamada. Aware deja en registro_llamada un único registro por
 * contacto de la base (el último intento): si el agente llama 2-3 veces al
 * mismo cliente, los intentos anteriores quedan grabados pero solo existen en
 * el CDR — en oct-2026 eran ~40% de las llamadas contestadas, incluidas
 * llamadas de más de una hora (ej. Laura Ladino, 5-oct, 71 min).
 *
 * - Una fila por llamada (DISTINCT ON uniqueid), grabada, del marcador
 *   (outbound) y de la cola (inbound): todas las de registro_llamada más los
 *   intentos no registrados que fueron contestados.
 * - Campaña: la del CDR; si no está, la de cdr_aware; si es entrante sin
 *   registro, la de otra llamada de la misma cola.
 * - Solo columnas necesarias: json_data trae datos sensibles del asegurado
 *   (correo, dirección, respuesta de seguridad) que no deben salir de Aware.
 */
function callsSql(where) {
  return `
    WITH base AS (
      SELECT DISTINCT ON (cu.uniqueid)
             cu.uniqueid, cu.registro_llamada_id, cu.context, cu.cola, cu.call_start, cu.billsec,
             cu.audiofile, cu.telefono, NULLIF(cu.agente_id, '') AS cdr_agente,
             split_part(CASE WHEN cu.context = 'aware-cola-inbound' THEN cu.dstchannel ELSE cu.channel END, '-', 1) AS ext,
             NULLIF(cu.proyecto_id, 0) AS cdr_proyecto
      FROM cdr_custom cu
      WHERE ${where}
        -- Todo lo que ya estaba en registro_llamada (como antes, aunque la
        -- central lo marque "NO ANSWER": timbró sin contestar) + los intentos
        -- no registrados que sí fueron conversación.
        AND (cu.disposition = 'ANSWERED' OR cu.registro_llamada_id IS NOT NULL)
        AND cu.billsec > 0 AND COALESCE(cu.audiofile, '') <> ''
        AND cu.context IN ('racodialer-asistido', 'aware-cola-inbound')
      -- Una misma llamada puede tener 2 filas (una ligada a registro_llamada
      -- y otra no): se prefiere la registrada.
      ORDER BY cu.uniqueid, (cu.registro_llamada_id IS NOT NULL) DESC, cu.id DESC
    )
    SELECT b.uniqueid, b.registro_llamada_id, b.context, b.billsec, b.audiofile, b.telefono, b.cdr_agente, b.ext,
           b.call_start::text AS inicio,
           COALESCE(
             b.cdr_proyecto,
             (SELECT MAX(ca.proyecto_id) FROM cdr_aware ca WHERE ca.uniqueid = b.uniqueid AND ca.proyecto_id > 0),
             (SELECT x.proyecto_id FROM cdr_custom x WHERE b.cola <> '' AND x.cola = b.cola AND x.proyecto_id > 0 ORDER BY x.id DESC LIMIT 1)
           ) AS proyecto_id,
           rl.agente_id AS rl_agente,
           rl.json_data->>'agente' AS rl_nombre
    FROM base b
    LEFT JOIN registro_llamada rl ON rl.registro_llamada_id = b.registro_llamada_id`;
}

const cleanName = (n) => (n ? n.replace(/\s+/g, ' ').trim() : null);
const toMs = (inicio) => new Date(String(inicio).replace(' ', 'T')).getTime();

// ── Zoom Phone ─────────────────────────────────────────────────────────────
// Los agentes de Asiste también llaman por Zoom Phone (misma cuenta de Zoom que
// usa el módulo de Obama). Se leen en vivo de la API —como Aware— para tener
// hora y dirección de cada llamada (la tabla `recordings` solo guarda la fecha)
// y no depender del escaneo intradiario.
const ZOOM_PREFIX = 'zoom:';
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000; // UTC-5, sin horario de verano
const isZoomId = (uniqueid) => String(uniqueid || '').startsWith(ZOOM_PREFIX);
const zoomEnabled = () => !!process.env.ZOOM_ACCOUNT_ID;
const bogota = (utc) => new Date(new Date(utc).getTime() - BOGOTA_OFFSET_MS).toISOString();
const nextDay = (d) => new Date(new Date(`${d}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
const BIENVENIDA_IDS = Object.keys(source.campaigns.bienvenida.proyectos).map(Number);
const CUSTOMER_IDS = Object.keys(source.campaigns.customer.proyectos).map(Number);

class ObamaVitalService {
  campaignForProyecto(proyectoId) {
    return PROYECTO_MAP.get(Number(proyectoId)) || null;
  }

  proyectoIdsFor(campaign) {
    if (!campaign) return ALL_PROYECTO_IDS;
    const cfg = source.campaigns[campaign];
    if (!cfg) throw httpError(400, 'Campaña inválida');
    return Object.keys(cfg.proyectos).map(Number);
  }

  async _connect() {
    const pgClient = new PGClient({ ...source.db, statement_timeout: 20000, connectionTimeoutMillis: 10000 });
    pgClient.on('error', (err) => logger.error('ObamaVitalService: error de conexión', err));
    await pgClient.connect();
    return pgClient;
  }

  getAudioUrl(audiofile) {
    return `${source.audioBaseUrl}/${audiofile}.WAV`;
  }

  /**
   * Lee llamadas del CDR y les resuelve el agente:
   *  1. el de registro_llamada, si el intento quedó registrado;
   *  2. el que trae el propio CDR;
   *  3. el de la extensión: la llamada registrada más cercana en el tiempo
   *     hecha desde esa misma extensión ese día (una extensión puede pasar
   *     de un agente a otro en el día, por eso "la más cercana").
   * Las que no se pueden atribuir a ningún agente se descartan.
   */
  async _fetchCalls(pgClient, where, params) {
    const { rows } = await pgClient.query(callsSql(where), params);
    if (!rows.length) return [];

    const fechas = [...new Set(rows.map((r) => String(r.inicio).slice(0, 10)))];
    const anchorsRes = await pgClient.query(
      `SELECT split_part(CASE WHEN context = 'aware-cola-inbound' THEN dstchannel ELSE channel END, '-', 1) AS ext,
              agente_id, call_start::text AS inicio
       FROM cdr_custom
       WHERE agente_id <> '' AND call_start::date = ANY($1::date[])`,
      [fechas]
    );
    const anchorsByExt = new Map();
    for (const a of anchorsRes.rows) {
      if (!anchorsByExt.has(a.ext)) anchorsByExt.set(a.ext, []);
      anchorsByExt.get(a.ext).push({ agente: a.agente_id, ms: toMs(a.inicio), dia: String(a.inicio).slice(0, 10) });
    }
    const agentByExt = (ext, inicio) => {
      const t = toMs(inicio);
      const dia = String(inicio).slice(0, 10);
      let best = null;
      for (const a of anchorsByExt.get(ext) || []) {
        if (a.dia !== dia) continue;
        if (!best || Math.abs(a.ms - t) < Math.abs(best.ms - t)) best = a;
      }
      return best?.agente || null;
    };

    const calls = [];
    let sinAgente = 0;
    for (const r of rows) {
      const info = this.campaignForProyecto(r.proyecto_id);
      if (!info) continue;
      const agenteId = r.rl_agente || r.cdr_agente || agentByExt(r.ext, r.inicio);
      if (!agenteId) { sinAgente++; continue; }
      calls.push({
        uniqueid: r.uniqueid,
        registro_llamada_id: r.registro_llamada_id ? Number(r.registro_llamada_id) : null,
        registrada: !!r.registro_llamada_id,
        proyecto_id: Number(r.proyecto_id),
        proyecto_nombre: info.proyectoName,
        campaign: info.campaign,
        fecha: String(r.inicio).slice(0, 10),
        hora: String(r.inicio).slice(11, 19),
        telefono: r.telefono,
        agente_id: agenteId,
        agente_nombre: cleanName(r.rl_nombre),
        duracion: r.billsec,
        audiofile: r.audiofile,
      });
    }
    if (sinAgente) logger.warn(`ObamaVitalService: ${sinAgente} llamadas sin agente identificable (se omiten)`);

    // Nombres de los agentes que no vienen de registro_llamada
    const sinNombre = [...new Set(calls.filter((c) => !c.agente_nombre).map((c) => c.agente_id))];
    if (sinNombre.length) {
      const names = await pgClient.query(
        `SELECT DISTINCT ON (agente_id) agente_id, json_data->>'agente' AS nombre
         FROM registro_llamada WHERE agente_id = ANY($1::text[]) AND json_data->>'agente' IS NOT NULL
         ORDER BY agente_id, registro_llamada_id DESC`,
        [sinNombre]
      );
      const nameMap = new Map(names.rows.map((n) => [n.agente_id, cleanName(n.nombre)]));
      for (const c of calls) if (!c.agente_nombre) c.agente_nombre = nameMap.get(c.agente_id) || null;
    }
    return calls;
  }

  /** Auditoría existente de cada llamada (por uniqueid o, en las viejas, por registro_llamada_id). */
  async _auditsFor(calls) {
    if (!calls.length) return { byUnique: new Map(), byRegistro: new Map() };
    const audits = await db('obama_vital_audits')
      .whereIn('uniqueid', calls.map((c) => c.uniqueid))
      .orWhereIn('registro_llamada_id', calls.map((c) => c.registro_llamada_id).filter(Boolean))
      .select('id', 'uniqueid', 'registro_llamada_id', 'status', 'score');
    return {
      byUnique: new Map(audits.filter((a) => a.uniqueid).map((a) => [a.uniqueid, a])),
      byRegistro: new Map(audits.filter((a) => a.registro_llamada_id).map((a) => [a.registro_llamada_id, a])),
    };
  }

  /**
   * Agentes de Asiste (los que aparecen en el Aware de Asiste) con su nombre y
   * cuántas llamadas tienen en cada campaña. Se cachea 10 minutos.
   */
  async _asisteAgents() {
    if (this._agentsCache && Date.now() - this._agentsCache.at < 10 * 60 * 1000) return this._agentsCache.map;
    const pgClient = await this._connect();
    let rows;
    try {
      ({ rows } = await pgClient.query(
        `SELECT agente_id, proyecto_id, COUNT(*)::int AS n, MAX(json_data->>'agente') AS nombre
         FROM registro_llamada WHERE agente_id IS NOT NULL AND agente_id <> '' GROUP BY 1, 2`
      ));
    } finally {
      await pgClient.end().catch(() => {});
    }
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.agente_id)) map.set(r.agente_id, { id: r.agente_id, name: cleanName(r.nombre), proyectos: {} });
      const a = map.get(r.agente_id);
      a.proyectos[r.proyecto_id] = r.n;
      if (!a.name && r.nombre) a.name = cleanName(r.nombre);
    }
    this._agentsCache = { at: Date.now(), map };
    return map;
  }

  /**
   * Campaña de una llamada de Zoom (Zoom no sabe de campañas): entrantes de un
   * agente que atiende ObamaCus → su ObamaCus; el resto → su Bienvenida más
   * frecuente; si no tiene ninguna de las dos, su campaña más frecuente.
   */
  _zoomProyecto(agent, direction) {
    const top = (ids) => ids.filter((id) => agent.proyectos[id]).sort((a, b) => agent.proyectos[b] - agent.proyectos[a])[0];
    if (direction === 'inbound') {
      const cus = top(CUSTOMER_IDS);
      if (cus) return cus;
    }
    return top(BIENVENIDA_IDS) || top(Object.keys(agent.proyectos).map(Number).filter((id) => PROYECTO_MAP.has(id))) || null;
  }

  /**
   * Grabaciones de Zoom Phone de un día (hora Bogotá) de agentes de Asiste.
   * Agente: nombre del usuario de Zoom contra los agentes de Asiste; si no
   * coincide, la extensión → cédula de la tabla `agents` (la del escaneo de Obama).
   */
  /**
   * Grabaciones de Zoom de un día, cacheadas 5 minutos. Si ya hay una consulta
   * en curso para ese día (ej. el auditor escribiendo un teléfono: una petición
   * por tecla), las demás esperan esa misma en vez de ir otra vez a Zoom.
   */
  async _zoomCallsForDay(date) {
    if (!this._zoomCache) this._zoomCache = new Map();
    const cached = this._zoomCache.get(date);
    if (cached?.calls && Date.now() - cached.at < 5 * 60 * 1000) return cached.calls;
    if (cached?.pending) return cached.pending;

    const pending = this._loadZoomCallsForDay(date);
    this._zoomCache.set(date, { pending });
    try {
      const calls = await pending;
      this._zoomCache.set(date, { at: Date.now(), calls });
      return calls;
    } catch (err) {
      this._zoomCache.delete(date);
      throw err;
    }
  }

  /**
   * Extensión de Zoom → cédula según la tabla `agents` (la del escaneo de
   * Obama). Una consulta por extensión con LIMIT 1 y cacheada por proceso: la
   * tabla tiene millones de filas duplicadas (oct-2026) y un GROUP BY sobre ella
   * tardaba minutos y dejaba la pantalla cargando.
   */
  async _cedulaPorExtension(ext) {
    if (!this._extCache) this._extCache = new Map();
    const hit = this._extCache.get(ext);
    if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.cedula;
    const row = await db('agents').where('zoom_extension', ext).whereNotNull('cedula').first('cedula');
    const cedula = row ? String(row.cedula) : null;
    this._extCache.set(ext, { at: Date.now(), cedula });
    return cedula;
  }

  async _loadZoomCallsForDay(date) {
    // Una llamada de las 7pm-12am de Bogotá ya es el día siguiente en UTC.
    const recs = [];
    let next = null;
    do {
      const params = { from: date, to: nextDay(date), page_size: 300 };
      if (next) params.next_page_token = next;
      const data = await ZoomAuth.get('/phone/recordings', params);
      recs.push(...(data.recordings || []));
      next = data.next_page_token || null;
    } while (next);

    const delDia = recs.filter((r) => r.download_url && r.date_time && bogota(r.date_time).slice(0, 10) === date);
    const agents = await this._asisteAgents();
    const candidatos = [...agents.values()].filter((a) => a.name);

    const calls = [];
    for (const r of delDia) {
      const ext = r.owner?.extension_number ? String(r.owner.extension_number) : null;
      // Primero el nombre del usuario de Zoom (regla estricta, contra los
      // agentes de Asiste); la asociación extensión→cédula de la tabla `agents`
      // solo si el nombre no coincide (ej. usuarios genéricos). No al revés: el
      // escaneo de Obama asoció mal algunas extensiones (oct-2026: la 1445 de
      // Laura Ladino quedó con la cédula de Laura Perea).
      const cedula = bestNameMatch(r.owner?.name, candidatos)?.id || (ext ? await this._cedulaPorExtension(ext) : null);
      const agent = cedula ? agents.get(cedula) : null;
      if (!agent) continue; // no es agente de Asiste

      const proyectoId = this._zoomProyecto(agent, r.direction);
      const info = this.campaignForProyecto(proyectoId);
      if (!info) continue;
      const inicio = bogota(r.date_time);
      calls.push({
        uniqueid: `${ZOOM_PREFIX}${r.id}`,
        fuente: 'zoom',
        registro_llamada_id: null,
        registrada: true,
        proyecto_id: proyectoId,
        proyecto_nombre: info.proyectoName,
        campaign: info.campaign,
        fecha: inicio.slice(0, 10),
        hora: inicio.slice(11, 19),
        telefono: (r.direction === 'inbound' ? r.caller_number : r.callee_number) || null,
        direccion: r.direction === 'inbound' ? 'entrante' : 'saliente',
        agente_id: agent.id,
        agente_nombre: agent.name,
        duracion: r.duration || 0,
        audio_url: r.download_url,
      });
    }

    return calls;
  }

  /**
   * Llamadas contestadas y con grabación de un día, en vivo desde Aware.
   * Cada una sale marcada con su auditoría si ya existe (una por llamada).
   */
  async listCallsForDay({ date, campaign, telefono }) {
    const proyectoIds = new Set(this.proyectoIdsFor(campaign));
    const targetDate = date || new Date().toISOString().slice(0, 10);

    const params = [targetDate];
    let where = 'cu.call_start::date = $1::date';
    if (telefono) {
      params.push(`%${telefono}%`);
      where += ` AND cu.telefono ILIKE $${params.length}`;
    }

    const pgClient = await this._connect();
    let calls;
    try {
      calls = (await this._fetchCalls(pgClient, where, params))
        .filter((c) => proyectoIds.has(c.proyecto_id))
        .map((c) => ({ ...c, fuente: 'aware' }));
    } finally {
      await pgClient.end().catch(() => {});
    }

    // Zoom: si falla, se sigue mostrando lo de Aware y se avisa.
    let zoomError = null;
    if (zoomEnabled()) {
      try {
        const tel = telefono ? String(telefono).replace(/\D/g, '') : '';
        const zoom = (await this._zoomCallsForDay(targetDate))
          .filter((c) => proyectoIds.has(c.proyecto_id))
          .filter((c) => !tel || String(c.telefono || '').replace(/\D/g, '').includes(tel));
        calls.push(...zoom);
      } catch (err) {
        logger.error('ObamaVitalService: no se pudieron leer las grabaciones de Zoom', { message: err.message });
        zoomError = 'No se pudieron cargar las llamadas de Zoom en este momento; se muestran solo las de Aware.';
      }
    }
    calls.sort((a, b) => (a.hora < b.hora ? 1 : -1));

    const { byUnique, byRegistro } = await this._auditsFor(calls);
    const data = calls.map(({ audio_url, audiofile, ...c }) => {
      const audit = byUnique.get(c.uniqueid) || (c.registro_llamada_id && byRegistro.get(c.registro_llamada_id)) || null;
      return {
        ...c,
        audit_id: audit?.id || null,
        audit_status: audit?.status || null,
        audit_score: audit?.score ?? null,
      };
    });
    return { calls: data, zoomError };
  }

  /** Crea la auditoría de una llamada (identificada por su uniqueid de la central), o devuelve la que ya exista. */
  async selectOne({ uniqueid, fecha, userId }) {
    const existing = await db('obama_vital_audits').where('uniqueid', uniqueid).first();
    if (existing) return { id: existing.id };
    if (isZoomId(uniqueid)) return this._selectZoom({ uniqueid, fecha, userId });

    const pgClient = await this._connect();
    let call;
    try {
      [call] = await this._fetchCalls(pgClient, 'cu.uniqueid = $1', [uniqueid]);
    } finally {
      await pgClient.end().catch(() => {});
    }
    if (!call) throw httpError(404, 'Llamada no encontrada');

    // Auditoría anterior a este cambio (sin uniqueid): se le completa y se reutiliza.
    if (call.registro_llamada_id) {
      const legacy = await db('obama_vital_audits').where('registro_llamada_id', call.registro_llamada_id).first();
      if (legacy) {
        if (!legacy.uniqueid) await db('obama_vital_audits').where({ id: legacy.id }).update({ uniqueid });
        return { id: legacy.id };
      }
    }

    const info = this.campaignForProyecto(call.proyecto_id);
    await db('obama_vital_audits')
      .insert({
        uniqueid: call.uniqueid,
        registro_llamada_id: call.registro_llamada_id,
        proyecto_id: call.proyecto_id,
        campaign: info.campaign,
        campaign_key: info.key,
        agente_id: call.agente_id,
        agente_nombre: call.agente_nombre,
        telefono: call.telefono,
        fecha: call.fecha,
        hora: call.hora,
        duracion: call.duracion,
        audiofile: call.audiofile,
        auditor_id: userId,
        status: 'selected',
      })
      .onConflict('uniqueid')
      .ignore();

    const saved = await db('obama_vital_audits').where('uniqueid', call.uniqueid).first();
    return { id: saved.id };
  }

  /** Auditoría de una llamada de Zoom: se busca en las grabaciones de Zoom de su fecha. */
  async _selectZoom({ uniqueid, fecha, userId }) {
    if (!zoomEnabled()) throw httpError(400, 'Zoom no está configurado en este servidor');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))) throw httpError(400, 'fecha requerida para llamadas de Zoom');
    const call = (await this._zoomCallsForDay(fecha)).find((c) => c.uniqueid === uniqueid);
    if (!call) throw httpError(404, 'Llamada de Zoom no encontrada');

    const info = this.campaignForProyecto(call.proyecto_id);
    await db('obama_vital_audits')
      .insert({
        uniqueid: call.uniqueid,
        source: 'zoom',
        audio_url: call.audio_url,
        registro_llamada_id: null,
        proyecto_id: call.proyecto_id,
        campaign: info.campaign,
        campaign_key: info.key,
        agente_id: call.agente_id,
        agente_nombre: call.agente_nombre,
        telefono: call.telefono,
        fecha: call.fecha,
        hora: call.hora,
        duracion: call.duracion,
        audiofile: null,
        auditor_id: userId,
        status: 'selected',
      })
      .onConflict('uniqueid')
      .ignore();
    const saved = await db('obama_vital_audits').where('uniqueid', call.uniqueid).first();
    return { id: saved.id };
  }

  /** Audio crudo de una auditoría, de Aware o de Zoom según su fuente. */
  async _rawAudio(audit) {
    if (audit.source === 'zoom') {
      if (!audit.audio_url) throw httpError(404, 'Esta llamada no tiene audio disponible');
      return ZoomAuth.download(audit.audio_url);
    }
    if (!audit.audiofile) throw httpError(404, 'Esta llamada no tiene audio disponible');
    return downloadBuffer(this.getAudioUrl(audit.audiofile));
  }

  async getById(id) {
    const audit = await db('obama_vital_audits as a')
      .leftJoin('users as u', 'a.auditor_id', 'u.id')
      .where('a.id', id)
      .select('a.*', 'u.name as auditor_nombre')
      .first();
    if (!audit) return null;
    // La URL de descarga de Zoom no sale al navegador: el audio pasa por el backend.
    const { audio_url, ...rest } = audit;
    return {
      ...rest,
      proyecto_nombre: this.campaignForProyecto(audit.proyecto_id)?.proyectoName || null,
    };
  }

  /** Filtros comunes del historial y de su exportación a Excel. */
  _auditFilters(query, { status, campaign, source, dateFrom, dateTo, agente, telefono }) {
    if (status) query.where('a.status', status);
    if (campaign) query.where('a.campaign', campaign);
    if (source) query.where('a.source', source);
    if (dateFrom) query.where('a.fecha', '>=', dateFrom);
    if (dateTo) query.where('a.fecha', '<=', dateTo);
    if (agente) {
      query.where((qb) => {
        qb.where('a.agente_id', 'like', `%${agente}%`).orWhere('a.agente_nombre', 'like', `%${agente}%`);
      });
    }
    if (telefono) query.where('a.telefono', 'like', `%${telefono}%`);
    return query;
  }

  /**
   * Auditorías filtradas con todo lo necesario para el Excel del historial:
   * criterios y observaciones — sin transcripción ni URL de audio.
   */
  async exportAudits(filters) {
    const query = db('obama_vital_audits as a')
      .leftJoin('users as u', 'a.auditor_id', 'u.id')
      .select(
        'a.id', 'a.source', 'a.proyecto_id', 'a.campaign', 'a.agente_id', 'a.agente_nombre', 'a.telefono',
        'a.fecha', 'a.hora', 'a.duracion', 'a.status', 'a.score', 'a.ai_score', 'a.high_impact_failed',
        'a.criteria_general', 'a.criteria_high_impact', 'a.notes', 'a.scored_at', 'a.analyzed_at',
        'u.name as auditor_nombre'
      )
      .orderBy('a.agente_nombre')
      .orderBy('a.fecha')
      .orderBy('a.hora')
      .limit(10000);
    const rows = await this._auditFilters(query, filters);
    const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v || []);
    return rows.map((r) => ({
      ...r,
      proyecto_nombre: this.campaignForProyecto(r.proyecto_id)?.proyectoName || null,
      criteria_general: parse(r.criteria_general),
      criteria_high_impact: parse(r.criteria_high_impact),
    }));
  }

  async listAudits({ status, campaign, source, dateFrom, dateTo, agente, telefono }) {
    const query = db('obama_vital_audits as a')
      .leftJoin('users as u', 'a.auditor_id', 'u.id')
      .select(
        'a.id', 'a.uniqueid', 'a.source', 'a.registro_llamada_id', 'a.proyecto_id', 'a.campaign', 'a.agente_id', 'a.agente_nombre',
        'a.telefono', 'a.fecha', 'a.hora', 'a.duracion', 'a.status', 'a.score', 'a.ai_score',
        'a.high_impact_failed', 'u.name as auditor_nombre'
      )
      .orderBy('a.fecha', 'desc')
      .orderBy('a.hora', 'desc')
      .limit(500);
    this._auditFilters(query, { status, campaign, source, dateFrom, dateTo, agente, telefono });

    const rows = await query;
    return rows.map((r) => ({
      ...r,
      proyecto_nombre: this.campaignForProyecto(r.proyecto_id)?.proyectoName || null,
    }));
  }

  async updateStatus(id, { status, notes }) {
    const update = { updated_at: db.fn.now() };
    if (status !== undefined) update.status = status;
    if (notes !== undefined) update.notes = notes;
    const affected = await db('obama_vital_audits').where({ id }).update(update);
    return affected > 0;
  }

  /** Plantilla en blanco de la matriz vigente (la que edita el auditor en Configuración). */
  async getCriteriaTemplate(campaign) {
    const cfg = source.campaigns[campaign];
    if (!cfg) throw httpError(400, 'Campaña inválida');
    const criteria = await CriteriaService.getByKey(cfg.key);
    return {
      label: criteria.label,
      general: criteria.general.map((item) => ({ ...item, cumple: true, na: false, observacion: '' })),
      highImpact: criteria.highImpact.map((item) => ({ ...item, cumple: true, observacion: '' })),
    };
  }

  /** Igual que AuditService/SofiaHumanService._calcScore. */
  _calcScore(criteria) {
    const highImpact = criteria.highImpact || [];
    const general = criteria.general || [];
    if (highImpact.some((i) => !i.cumple)) return { score: 0, highImpactFailed: true };
    let applicable = 0;
    let earned = 0;
    for (const item of general) {
      if (item.na) continue;
      applicable += Number(item.weight) || 0;
      if (item.cumple) earned += Number(item.weight) || 0;
    }
    return {
      score: applicable > 0 ? Math.round((earned / applicable) * 100) : 0,
      highImpactFailed: false,
    };
  }

  /** Calificación final del auditor (manual o corrigiendo la de la IA). */
  async saveScore(id, { criteria, notes }) {
    const { score, highImpactFailed } = this._calcScore(criteria);
    await db('obama_vital_audits')
      .where({ id })
      .update({
        criteria_general: JSON.stringify(criteria.general),
        criteria_high_impact: JSON.stringify(criteria.highImpact),
        high_impact_failed: highImpactFailed,
        score,
        notes: notes ?? null,
        status: 'completed',
        scored_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
    return { score, highImpactFailed };
  }

  /**
   * Precalificación con IA: transcribe y evalúa con la matriz de la campaña.
   * Queda "En revisión" — el auditor la valida o corrige y la cierra con saveScore.
   */
  async analyze(id) {
    const audit = await db('obama_vital_audits').where({ id }).first();
    if (!audit) throw httpError(404, 'Auditoría no encontrada');

    const t0 = Date.now();
    const rawBuffer = await this._rawAudio(audit);
    logger.info(`ObamaVitalService: audio descargado (${(rawBuffer.length / 1024).toFixed(0)} KB) en ${Date.now() - t0}ms`);

    // Opus 16kHz mono ~32kbps — igual que AnalysisService, evita timeouts en Gemini.
    const audioBuffer = await convertAudio(rawBuffer, ['-acodec', 'libopus', '-ar', '16000', '-ac', '1', '-b:a', '32k'], 'ogg');

    const { transcription, evaluation } = await GeminiService.analyzeCall(
      audioBuffer,
      audit.campaign_key,
      audit.agente_id,
      audit.proyecto_id,
      'audio/ogg',
      null,
      { flow: 'asiste' }
    );

    await db('obama_vital_audits')
      .where({ id })
      .update({
        criteria_general: JSON.stringify(evaluation.general),
        criteria_high_impact: JSON.stringify(evaluation.highImpact),
        high_impact_failed: evaluation.highImpactFailed,
        score: evaluation.score,
        ai_score: evaluation.score,
        ai_high_impact_failed: evaluation.highImpactFailed,
        notes: evaluation.summary || null,
        transcription: transcription || null,
        status: 'in_review',
        analyzed_at: db.fn.now(),
        updated_at: db.fn.now(),
      });

    logger.info(`ObamaVitalService: análisis IA completado para auditoría ${id}`, {
      score: evaluation.score,
      highImpactFailed: evaluation.highImpactFailed,
    });
    return { score: evaluation.score, highImpactFailed: evaluation.highImpactFailed, summary: evaluation.summary };
  }

  /** Audio convertido a WAV PCM para el reproductor del navegador. */
  async getPlayableAudio(id) {
    // Fila completa: getById() no expone audio_url (la URL de Zoom).
    const audit = await db('obama_vital_audits').where({ id }).first();
    if (!audit) throw httpError(404, 'Auditoría no encontrada');
    const rawBuffer = await this._rawAudio(audit);
    return convertAudio(rawBuffer, ['-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1'], 'wav');
  }

  /** Resumen por agente de las auditorías cerradas en un rango. */
  async agentSummary({ campaign, dateFrom, dateTo }) {
    const query = db('obama_vital_audits')
      .where('status', 'completed')
      .groupBy('agente_id')
      .select(
        'agente_id',
        db.raw('MAX(agente_nombre) AS agente_nombre'),
        db.raw('COUNT(*) AS auditorias'),
        db.raw('AVG(score) AS score_promedio'),
        db.raw('SUM(high_impact_failed = 1) AS fallas_alto_impacto')
      )
      .orderBy('score_promedio', 'asc');
    if (campaign) query.where('campaign', campaign);
    if (dateFrom) query.where('fecha', '>=', dateFrom);
    if (dateTo) query.where('fecha', '<=', dateTo);

    const rows = await query;
    return rows.map((r) => ({
      agente_id: r.agente_id,
      agente_nombre: r.agente_nombre,
      auditorias: Number(r.auditorias),
      score_promedio: r.score_promedio != null ? Math.round(Number(r.score_promedio)) : null,
      fallas_alto_impacto: Number(r.fallas_alto_impacto),
    }));
  }
}

module.exports = new ObamaVitalService();
