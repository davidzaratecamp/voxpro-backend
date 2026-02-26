const db = require('../database/connection');

class StatsService {
  /**
   * Resumen general del sistema.
   */
  async overview() {
    const [totals] = await db('recordings')
      .select(
        db.raw('COUNT(*) as total_recordings'),
        db.raw('SUM(file_size) as total_size_bytes'),
        db.raw("SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending"),
        db.raw("SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing"),
        db.raw("SUM(CASE WHEN status = 'transcribed' THEN 1 ELSE 0 END) as transcribed"),
        db.raw("SUM(CASE WHEN status = 'analyzed' THEN 1 ELSE 0 END) as analyzed"),
        db.raw("SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors"),
        db.raw("SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped"),
        db.raw('MIN(file_date) as earliest_date'),
        db.raw('MAX(file_date) as latest_date')
      );

    const lastScan = await db('processing_jobs')
      .where({ job_type: 'scan' })
      .orderBy('started_at', 'desc')
      .first();

    const [agentStats] = await db('recordings')
      .select(
        db.raw('COUNT(DISTINCT agent_id) as unique_agents'),
        db.raw('SUM(CASE WHEN agent_id IS NOT NULL THEN 1 ELSE 0 END) as enriched_with_agent'),
        db.raw('SUM(CASE WHEN agent_enriched = 1 AND agent_id IS NULL THEN 1 ELSE 0 END) as enriched_no_match')
      );

    return {
      ...totals,
      ...agentStats,
      total_size_gb: totals.total_size_bytes
        ? (Number(totals.total_size_bytes) / (1024 * 1024 * 1024)).toFixed(2)
        : '0',
      last_scan: lastScan || null,
    };
  }

  /**
   * Grabaciones por cliente.
   */
  async byClient() {
    return db('recordings as r')
      .join('aware_sources as s', 'r.aware_source_id', 's.id')
      .join('clients as c', 's.client_id', 'c.id')
      .select(
        'c.code as client_code',
        'c.name as client_name',
        db.raw('COUNT(*) as total'),
        db.raw("SUM(CASE WHEN r.status = 'pending' THEN 1 ELSE 0 END) as pending"),
        db.raw("SUM(CASE WHEN r.status = 'transcribed' THEN 1 ELSE 0 END) as transcribed"),
        db.raw("SUM(CASE WHEN r.status = 'analyzed' THEN 1 ELSE 0 END) as analyzed"),
        db.raw("SUM(CASE WHEN r.status = 'error' THEN 1 ELSE 0 END) as errors"),
        db.raw('SUM(r.file_size) as total_size_bytes')
      )
      .groupBy('c.id', 'c.code', 'c.name')
      .orderBy('total', 'desc');
  }

  /**
   * Grabaciones por día para un rango de fechas.
   */
  async daily({ dateFrom, dateTo, clientCode } = {}) {
    const query = db('recordings as r')
      .join('aware_sources as s', 'r.aware_source_id', 's.id')
      .join('clients as c', 's.client_id', 'c.id')
      .select(
        'r.file_date as date',
        db.raw('COUNT(*) as total'),
        db.raw("SUM(CASE WHEN r.status = 'pending' THEN 1 ELSE 0 END) as pending"),
        db.raw("SUM(CASE WHEN r.status = 'analyzed' THEN 1 ELSE 0 END) as analyzed")
      )
      .whereNotNull('r.file_date')
      .groupBy('r.file_date')
      .orderBy('r.file_date', 'desc')
      .limit(90);

    if (dateFrom) query.where('r.file_date', '>=', dateFrom);
    if (dateTo) query.where('r.file_date', '<=', dateTo);
    if (clientCode) query.where('c.code', clientCode);

    return query;
  }

  /**
   * Lista agentes únicos con conteo de grabaciones.
   */
  async agents({ clientCode } = {}) {
    const query = db('recordings as r')
      .join('aware_sources as s', 'r.aware_source_id', 's.id')
      .join('clients as c', 's.client_id', 'c.id')
      .whereNotNull('r.agent_id')
      .where('r.agent_id', '!=', '-1')
      .select(
        'r.agent_id',
        db.raw('MAX(r.agent_name) as agent_name'),
        db.raw('MAX(r.agent_extension) as agent_extension'),
        'c.code as client_code',
        'c.name as client_name',
        db.raw('COUNT(*) as total_recordings'),
        db.raw('AVG(r.call_duration) as avg_duration'),
        db.raw('SUM(r.file_size) as total_size_bytes')
      )
      .groupBy('r.agent_id', 'c.code', 'c.name')
      .orderBy('total_recordings', 'desc');

    if (clientCode) query.where('c.code', clientCode);

    return query;
  }

  /**
   * Historial de jobs de procesamiento.
   */
  async jobHistory({ limit = 20 } = {}) {
    return db('processing_jobs')
      .orderBy('started_at', 'desc')
      .limit(limit);
  }
}

module.exports = new StatsService();
