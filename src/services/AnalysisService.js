const db = require('../database/connection');
const SFTPService = require('./SFTPService');
const GeminiService = require('./GeminiService');
const logger = require('../utils/logger');

class AnalysisService {
  /**
   * Analiza una auditoría: descarga audio, transcribe con Gemini, evalúa, guarda resultados.
   * @param {number} selectionId - ID de la audit_selection
   * @returns {object} Resultados de la evaluación
   */
  async analyzeSelection(selectionId) {
    // 1. Obtener datos de la selección + grabación
    const selection = await db('audit_selections as a')
      .join('recordings as r', 'a.recording_id', 'r.id')
      .where('a.id', selectionId)
      .select('a.id', 'a.recording_id', 'a.client_code', 'a.agent_id', 'a.agent_name', 'r.file_path', 'r.file_name', 'r.proyecto_id')
      .first();

    if (!selection) {
      throw new Error(`Selección no encontrada: ${selectionId}`);
    }

    logger.info(`Iniciando análisis de selección ${selectionId}`, {
      agent: selection.agent_name,
      client: selection.client_code,
      file: selection.file_name,
    });

    // 2. Descargar audio via SFTP
    const sftp = new SFTPService();
    let audioBuffer;
    try {
      await sftp.connect();
      audioBuffer = await sftp.getFile(selection.file_path);
      logger.info(`Audio descargado: ${(audioBuffer.length / 1024).toFixed(0)} KB`);
    } finally {
      await sftp.disconnect();
    }

    // 3. Enviar a Gemini para transcripción + evaluación
    const { transcription, evaluation } = await GeminiService.analyzeCall(
      audioBuffer,
      selection.client_code,
      selection.agent_id,
      selection.proyecto_id
    );

    // 4-7. Guardar resultados en una transacción
    await db.transaction(async (trx) => {
      // 4. Guardar transcripción
      await trx('transcriptions')
        .insert({
          recording_id: selection.recording_id,
          transcript_text: transcription,
          language: 'es',
          engine: 'gemini-2.0-flash',
        })
        .onConflict('recording_id')
        .merge(['transcript_text', 'engine']);

      // Recuperar el ID si fue merge
      const txRow = await trx('transcriptions')
        .where('recording_id', selection.recording_id)
        .select('id')
        .first();
      const txId = txRow.id;

      // 5. Guardar evaluación QA (con copia original inmutable)
      const criteriaJson = JSON.stringify({
        general: evaluation.general,
        highImpact: evaluation.highImpact,
        highImpactFailed: evaluation.highImpactFailed,
      });
      await trx('qa_evaluations').insert({
        recording_id: selection.recording_id,
        transcription_id: txId,
        score: evaluation.score,
        original_score: evaluation.score,
        criteria: criteriaJson,
        original_criteria: criteriaJson,
        summary: evaluation.summary,
        evaluator: 'gemini-2.0-flash',
      });

      // 6. Actualizar status de la selección y score
      await trx('audit_selections')
        .where('id', selectionId)
        .update({
          status: 'completed',
          score: evaluation.score,
          notes: evaluation.summary,
          updated_at: db.fn.now(),
        });

      // 7. Actualizar status de la grabación
      await trx('recordings')
        .where('id', selection.recording_id)
        .update({
          status: 'analyzed',
          processed_at: db.fn.now(),
          updated_at: db.fn.now(),
        });
    });

    logger.info(`Análisis completado para selección ${selectionId}`, {
      score: evaluation.score,
      highImpactFailed: evaluation.highImpactFailed,
    });

    return {
      selectionId,
      score: evaluation.score,
      highImpactFailed: evaluation.highImpactFailed,
      summary: evaluation.summary,
    };
  }

  /**
   * Obtiene los resultados de análisis de una selección.
   * @param {number} selectionId - ID de la audit_selection
   */
  async getResults(selectionId) {
    const selection = await db('audit_selections')
      .where('id', selectionId)
      .select('recording_id', 'client_code')
      .first();

    if (!selection) return null;

    const transcription = await db('transcriptions')
      .where('recording_id', selection.recording_id)
      .select('id', 'transcript_text', 'engine', 'created_at')
      .first();

    const evaluation = await db('qa_evaluations')
      .where('recording_id', selection.recording_id)
      .select('id', 'score', 'original_score', 'criteria', 'original_criteria', 'summary', 'evaluator', 'created_at')
      .orderBy('created_at', 'desc')
      .first();

    if (!transcription && !evaluation) return null;

    let criteria = null;
    if (evaluation?.criteria) {
      try {
        criteria = typeof evaluation.criteria === 'string'
          ? JSON.parse(evaluation.criteria)
          : evaluation.criteria;
      } catch {
        criteria = null;
      }
    }

    // Historial de cambios
    const changes = evaluation
      ? await db('evaluation_changes')
          .where('selection_id', selectionId)
          .orderBy('created_at', 'desc')
          .select('id', 'user_name', 'changes', 'score_before', 'score_after', 'created_at')
      : [];

    return {
      transcription: transcription?.transcript_text || null,
      engine: transcription?.engine || null,
      score: evaluation?.score ?? null,
      originalScore: evaluation?.original_score ?? null,
      criteria,
      summary: evaluation?.summary || null,
      analyzedAt: evaluation?.created_at || null,
      changes: changes.map((c) => ({
        ...c,
        changes: typeof c.changes === 'string' ? JSON.parse(c.changes) : c.changes,
      })),
    };
  }
  /**
   * Actualiza criterios de evaluación corregidos por el auditor.
   * Registra cada cambio individual para trazabilidad.
   */
  async updateEvaluation(selectionId, { criteria, score, user }) {
    const selection = await db('audit_selections')
      .where('id', selectionId)
      .select('recording_id')
      .first();

    if (!selection) return null;

    // Obtener evaluación actual para comparar
    const current = await db('qa_evaluations')
      .where('recording_id', selection.recording_id)
      .orderBy('created_at', 'desc')
      .select('id', 'score', 'criteria')
      .first();

    if (!current) return null;

    const oldCriteria = typeof current.criteria === 'string'
      ? JSON.parse(current.criteria)
      : current.criteria;

    // Detectar cambios individuales
    const changesList = [];

    // Comparar high impact
    const oldHI = oldCriteria.highImpact || [];
    const newHI = criteria.highImpact || [];
    for (let i = 0; i < newHI.length; i++) {
      const oldItem = oldHI[i];
      const newItem = newHI[i];
      if (oldItem && newItem && oldItem.cumple !== newItem.cumple) {
        changesList.push({
          key: newItem.key,
          type: 'high_impact',
          label: newItem.label,
          from: oldItem.cumple ? 'Cumple' : 'No Cumple',
          to: newItem.cumple ? 'Cumple' : 'No Cumple',
        });
      }
    }

    // Comparar general
    const oldGen = oldCriteria.general || [];
    const newGen = criteria.general || [];
    for (let i = 0; i < newGen.length; i++) {
      const oldItem = oldGen[i];
      const newItem = newGen[i];
      if (oldItem && newItem && oldItem.cumple !== newItem.cumple && !newItem.na) {
        changesList.push({
          key: newItem.key,
          type: 'general',
          label: newItem.label,
          from: oldItem.cumple ? 'Cumple' : 'No Cumple',
          to: newItem.cumple ? 'Cumple' : 'No Cumple',
        });
      }
    }

    // Guardar cambios en una transacción
    await db.transaction(async (trx) => {
      if (changesList.length > 0) {
        await trx('evaluation_changes').insert({
          qa_evaluation_id: current.id,
          selection_id: selectionId,
          user_id: user.id,
          user_name: user.name,
          changes: JSON.stringify(changesList),
          score_before: current.score,
          score_after: score,
        });
      }

      await trx('qa_evaluations')
        .where('id', current.id)
        .update({
          score,
          criteria: JSON.stringify(criteria),
          evaluator: 'gemini-2.0-flash+auditor',
        });

      await trx('audit_selections')
        .where('id', selectionId)
        .update({
          score,
          updated_at: db.fn.now(),
        });
    });

    if (changesList.length > 0) {
      logger.info(`Evaluación ${selectionId} editada por ${user.name}`, {
        changes: changesList.length,
        scoreBefore: current.score,
        scoreAfter: score,
      });
    }

    return { selectionId, score, changes: changesList.length };
  }
}

module.exports = new AnalysisService();
