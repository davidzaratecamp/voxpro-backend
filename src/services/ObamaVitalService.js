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
      calls = (await this._fetchCalls(pgClient, where, params)).filter((c) => proyectoIds.has(c.proyecto_id));
    } finally {
      await pgClient.end().catch(() => {});
    }
    calls.sort((a, b) => (a.hora < b.hora ? 1 : -1));

    const { byUnique, byRegistro } = await this._auditsFor(calls);
    return calls.map((c) => {
      const audit = byUnique.get(c.uniqueid) || (c.registro_llamada_id && byRegistro.get(c.registro_llamada_id)) || null;
      return {
        ...c,
        audit_id: audit?.id || null,
        audit_status: audit?.status || null,
        audit_score: audit?.score ?? null,
      };
    });
  }

  /** Crea la auditoría de una llamada (identificada por su uniqueid de la central), o devuelve la que ya exista. */
  async selectOne({ uniqueid, userId }) {
    const existing = await db('obama_vital_audits').where('uniqueid', uniqueid).first();
    if (existing) return { id: existing.id };

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

  async getById(id) {
    const audit = await db('obama_vital_audits as a')
      .leftJoin('users as u', 'a.auditor_id', 'u.id')
      .where('a.id', id)
      .select('a.*', 'u.name as auditor_nombre')
      .first();
    if (!audit) return null;
    return {
      ...audit,
      proyecto_nombre: this.campaignForProyecto(audit.proyecto_id)?.proyectoName || null,
    };
  }

  async listAudits({ status, campaign, dateFrom, dateTo, agente, telefono }) {
    const query = db('obama_vital_audits as a')
      .leftJoin('users as u', 'a.auditor_id', 'u.id')
      .select(
        'a.id', 'a.uniqueid', 'a.registro_llamada_id', 'a.proyecto_id', 'a.campaign', 'a.agente_id', 'a.agente_nombre',
        'a.telefono', 'a.fecha', 'a.hora', 'a.duracion', 'a.status', 'a.score', 'a.ai_score',
        'a.high_impact_failed', 'u.name as auditor_nombre'
      )
      .orderBy('a.fecha', 'desc')
      .orderBy('a.hora', 'desc')
      .limit(500);

    if (status) query.where('a.status', status);
    if (campaign) query.where('a.campaign', campaign);
    if (dateFrom) query.where('a.fecha', '>=', dateFrom);
    if (dateTo) query.where('a.fecha', '<=', dateTo);
    if (agente) {
      query.where((qb) => {
        qb.where('a.agente_id', 'like', `%${agente}%`).orWhere('a.agente_nombre', 'like', `%${agente}%`);
      });
    }
    if (telefono) query.where('a.telefono', 'like', `%${telefono}%`);

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
    if (!audit.audiofile) throw httpError(404, 'Esta llamada no tiene audio disponible');

    const t0 = Date.now();
    const rawBuffer = await downloadBuffer(this.getAudioUrl(audit.audiofile));
    logger.info(`ObamaVitalService: audio descargado (${(rawBuffer.length / 1024).toFixed(0)} KB) en ${Date.now() - t0}ms`);

    // Opus 16kHz mono ~32kbps — igual que AnalysisService, evita timeouts en Gemini.
    const audioBuffer = await convertAudio(rawBuffer, ['-acodec', 'libopus', '-ar', '16000', '-ac', '1', '-b:a', '32k'], 'ogg');

    const { transcription, evaluation } = await GeminiService.analyzeCall(
      audioBuffer,
      audit.campaign_key,
      audit.agente_id,
      audit.proyecto_id,
      'audio/ogg',
      null
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
  async getPlayableAudio(audiofile) {
    const rawBuffer = await downloadBuffer(this.getAudioUrl(audiofile));
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
