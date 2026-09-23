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

function toDateStr(v) {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
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

// Solo las columnas necesarias: json_data trae datos sensibles del asegurado
// (correo, dirección, respuesta de seguridad) que no deben salir de Aware.
const CALL_COLUMNS = `
  registro_llamada_id, proyecto_id, registro_llamada_fecha, registro_llamada_hora,
  registro_llamada_fono, agente_id, time_speaking, audiofile,
  json_data->>'agente' AS agente_nombre`;

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

  _mapRow(row) {
    const info = this.campaignForProyecto(row.proyecto_id);
    return {
      registro_llamada_id: row.registro_llamada_id,
      proyecto_id: row.proyecto_id,
      proyecto_nombre: info?.proyectoName || null,
      campaign: info?.campaign || null,
      fecha: toDateStr(row.registro_llamada_fecha),
      hora: row.registro_llamada_hora,
      telefono: row.registro_llamada_fono,
      agente_id: row.agente_id,
      agente_nombre: row.agente_nombre ? row.agente_nombre.replace(/\s+/g, ' ').trim() : null,
      duracion: row.time_speaking,
      audiofile: row.audiofile,
    };
  }

  getAudioUrl(audiofile) {
    return `${source.audioBaseUrl}/${audiofile}.WAV`;
  }

  /**
   * Llamadas contestadas y con grabación de un día, en vivo desde Aware.
   * Cada una sale marcada con su auditoría si ya existe (una por llamada).
   */
  async listCallsForDay({ date, campaign, telefono }) {
    const proyectoIds = this.proyectoIdsFor(campaign);
    const targetDate = date || new Date().toISOString().slice(0, 10);

    const conditions = [
      'proyecto_id = ANY($1::int[])',
      'registro_llamada_fecha = $2',
      'time_speaking > 0',
      'audiofile IS NOT NULL',
      'agente_id IS NOT NULL',
    ];
    const params = [proyectoIds, targetDate];
    if (telefono) {
      params.push(`%${telefono}%`);
      conditions.push(`registro_llamada_fono ILIKE $${params.length}`);
    }

    const pgClient = await this._connect();
    let calls;
    try {
      const result = await pgClient.query(
        `SELECT ${CALL_COLUMNS}
         FROM registro_llamada
         WHERE ${conditions.join(' AND ')}
         ORDER BY registro_llamada_hora DESC
         LIMIT 1000`,
        params
      );
      calls = result.rows.map((r) => this._mapRow(r));
    } finally {
      await pgClient.end().catch(() => {});
    }

    if (!calls.length) return calls;
    const audits = await db('obama_vital_audits')
      .whereIn('registro_llamada_id', calls.map((c) => c.registro_llamada_id))
      .select('id', 'registro_llamada_id', 'status', 'score');
    const byCall = new Map(audits.map((a) => [a.registro_llamada_id, a]));

    return calls.map((c) => {
      const audit = byCall.get(c.registro_llamada_id);
      return {
        ...c,
        audit_id: audit?.id || null,
        audit_status: audit?.status || null,
        audit_score: audit?.score ?? null,
      };
    });
  }

  /** Crea la auditoría de una llamada, o devuelve la que ya exista. */
  async selectOne({ registroLlamadaId, userId }) {
    const existing = await db('obama_vital_audits').where('registro_llamada_id', registroLlamadaId).first();
    if (existing) return { id: existing.id };

    const pgClient = await this._connect();
    let row;
    try {
      const result = await pgClient.query(
        `SELECT ${CALL_COLUMNS}
         FROM registro_llamada
         WHERE registro_llamada_id = $1 AND proyecto_id = ANY($2::int[])
         LIMIT 1`,
        [registroLlamadaId, ALL_PROYECTO_IDS]
      );
      row = result.rows[0];
    } finally {
      await pgClient.end().catch(() => {});
    }
    if (!row) throw httpError(404, 'Llamada no encontrada');

    const call = this._mapRow(row);
    const info = this.campaignForProyecto(call.proyecto_id);

    await db('obama_vital_audits')
      .insert({
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
      .onConflict('registro_llamada_id')
      .ignore();

    const saved = await db('obama_vital_audits').where('registro_llamada_id', call.registro_llamada_id).first();
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
        'a.id', 'a.registro_llamada_id', 'a.proyecto_id', 'a.campaign', 'a.agente_id', 'a.agente_nombre',
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
