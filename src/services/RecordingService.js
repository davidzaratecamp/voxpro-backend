const db = require('../database/connection');

class RecordingService {
  /**
   * Lista grabaciones con filtros, paginación y orden.
   */
  async list({
    clientCode,
    sourceId,
    status,
    dateFrom,
    dateTo,
    search,
    agentId,
    page = 1,
    limit = 50,
    sortBy = 'file_date',
    sortDir = 'desc',
  } = {}) {
    const query = db('recordings as r')
      .join('aware_sources as s', 'r.aware_source_id', 's.id')
      .join('clients as c', 's.client_id', 'c.id');

    if (clientCode) query.where('c.code', clientCode);
    if (sourceId) query.where('r.aware_source_id', sourceId);
    if (status) query.where('r.status', status);
    if (dateFrom) query.where('r.file_date', '>=', dateFrom);
    if (dateTo) query.where('r.file_date', '<=', dateTo);
    if (agentId) query.where('r.agent_id', agentId);
    if (search) {
      query.where(function () {
        this.where('r.file_name', 'like', `%${search}%`)
          .orWhere('r.call_phone', 'like', `%${search}%`)
          .orWhere('r.agent_name', 'like', `%${search}%`)
          .orWhere('r.agent_id', 'like', `%${search}%`);
      });
    }

    // Contar total antes de paginar
    const countQuery = query.clone().count('r.id as total').first();
    const { total } = await countQuery;

    // Columnas válidas para ordenar
    const validSorts = ['file_date', 'file_size', 'discovered_at', 'status', 'file_name', 'agent_name', 'call_duration'];
    const safeSort = validSorts.includes(sortBy) ? `r.${sortBy}` : 'r.file_date';
    const safeDir = sortDir === 'asc' ? 'asc' : 'desc';

    const offset = (page - 1) * limit;
    const rows = await query
      .clone()
      .select(
        'r.id',
        'r.file_name',
        'r.file_path',
        'r.file_size',
        'r.file_date',
        'r.call_phone',
        'r.call_id',
        'r.is_queue_call',
        'r.status',
        'r.discovered_at',
        'r.processed_at',
        'r.agent_id',
        'r.agent_name',
        'r.agent_extension',
        'r.call_duration',
        'c.name as client_name',
        'c.code as client_code',
        's.folder_name as source_folder'
      )
      .orderBy(safeSort, safeDir)
      .limit(limit)
      .offset(offset);

    return {
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Obtiene una grabación por ID con todos sus datos.
   */
  async getById(id) {
    const recording = await db('recordings as r')
      .join('aware_sources as s', 'r.aware_source_id', 's.id')
      .join('clients as c', 's.client_id', 'c.id')
      .leftJoin('transcriptions as t', 'r.id', 't.recording_id')
      .select(
        'r.*',
        'c.name as client_name',
        'c.code as client_code',
        's.folder_name as source_folder',
        't.transcript_text',
        't.confidence as transcript_confidence',
        't.duration_seconds',
        't.engine as transcript_engine'
      )
      .where('r.id', id)
      .first();

    if (!recording) return null;

    // Cargar evaluaciones QA si existen
    const evaluations = await db('qa_evaluations')
      .where({ recording_id: id })
      .orderBy('created_at', 'desc');

    return { ...recording, evaluations };
  }

  /**
   * Actualiza el estado de una grabación.
   */
  async updateStatus(id, status, errorMessage = null) {
    const update = {
      status,
      updated_at: db.fn.now(),
    };

    if (status === 'error') {
      update.error_message = errorMessage;
    }

    if (['transcribed', 'analyzed'].includes(status)) {
      update.processed_at = db.fn.now();
    }

    return db('recordings').where({ id }).update(update);
  }

  /**
   * Obtiene grabaciones pendientes de procesar para un pipeline.
   */
  async getPending({ limit = 100, clientCode } = {}) {
    const query = db('recordings as r')
      .join('aware_sources as s', 'r.aware_source_id', 's.id')
      .join('clients as c', 's.client_id', 'c.id')
      .where('r.status', 'pending')
      .select('r.*', 'c.code as client_code', 's.folder_name')
      .orderBy('r.file_date', 'desc')
      .limit(limit);

    if (clientCode) query.where('c.code', clientCode);

    return query;
  }
}

module.exports = new RecordingService();
