const db = require('../database/connection');

class ReportsService {
  constructor() {
    if (ReportsService.instance) return ReportsService.instance;
    ReportsService.instance = this;
  }

  _resolveDateRange(period, customFrom, customTo) {
    const now = new Date();
    let dateFrom, dateTo;

    if (period === 'custom') {
      dateFrom = customFrom;
      dateTo = customTo;
    } else if (period === '1m') {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 1);
      dateFrom = d.toISOString().slice(0, 10);
      dateTo = now.toISOString().slice(0, 10);
    } else if (period === '3m') {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 3);
      dateFrom = d.toISOString().slice(0, 10);
      dateTo = now.toISOString().slice(0, 10);
    } else {
      // default '4w' — last 28 days
      const d = new Date(now);
      d.setDate(d.getDate() - 28);
      dateFrom = d.toISOString().slice(0, 10);
      dateTo = now.toISOString().slice(0, 10);
    }

    return { dateFrom, dateTo };
  }

  async getKPIs({ period = '4w', customFrom, customTo, clientCodes }) {
    const { dateFrom, dateTo } = this._resolveDateRange(period, customFrom, customTo);

    let query = db('audit_selections as a')
      .join('recordings as r', 'r.id', 'a.recording_id')
      .leftJoin('qa_evaluations as q', 'q.recording_id', 'a.recording_id')
      .whereBetween('r.file_date', [dateFrom, dateTo]);

    if (clientCodes && clientCodes.length > 0) {
      query = query.whereIn('a.client_code', clientCodes);
    }

    const [row] = await query.select(
      db.raw(`COUNT(CASE WHEN a.status = 'completed' THEN 1 END) as total_completed`),
      db.raw(`ROUND(AVG(CASE WHEN a.status = 'completed' AND a.score > 0 THEN a.score END)) as avg_score`),
      db.raw(`COUNT(DISTINCT CASE WHEN a.status = 'completed' AND a.score < 60 THEN a.agent_id END) as agents_at_risk`),
      db.raw(`SUM(CASE WHEN JSON_EXTRACT(q.criteria, '$.highImpactFailed') = true THEN 1 ELSE 0 END) as high_impact_failures`)
    );

    return {
      total_completed: Number(row.total_completed) || 0,
      avg_score: Number(row.avg_score) || 0,
      agents_at_risk: Number(row.agents_at_risk) || 0,
      high_impact_failures: Number(row.high_impact_failures) || 0,
    };
  }

  async getWeeklyTrend({ clientCodes }) {
    // Get last 12 distinct week_start values
    let weekQuery = db('audit_selections')
      .distinct('week_start')
      .orderBy('week_start', 'desc')
      .limit(12);

    if (clientCodes && clientCodes.length > 0) {
      weekQuery = weekQuery.whereIn('client_code', clientCodes);
    }

    const weekRows = await weekQuery;
    if (weekRows.length === 0) return [];

    const weeks = weekRows.map((w) => w.week_start).reverse();

    let trendQuery = db('audit_selections as a')
      .join('recordings as r', 'r.id', 'a.recording_id')
      .whereIn('a.week_start', weeks)
      .where('a.status', 'completed')
      .groupBy('a.week_start', 'a.client_code')
      .select(
        'a.week_start',
        'a.client_code',
        db.raw('ROUND(AVG(NULLIF(a.score, 0)), 1) as avg_score'),
        db.raw('COUNT(*) as count')
      )
      .orderBy('a.week_start', 'asc');

    if (clientCodes && clientCodes.length > 0) {
      trendQuery = trendQuery.whereIn('a.client_code', clientCodes);
    }

    const rows = await trendQuery;
    return rows.map((r) => ({
      week_start: r.week_start instanceof Date ? r.week_start.toISOString().slice(0, 10) : String(r.week_start).slice(0, 10),
      client_code: r.client_code,
      avg_score: Number(r.avg_score),
      count: Number(r.count),
    }));
  }

  async getScoreByClient({ period = '4w', customFrom, customTo, clientCodes }) {
    const { dateFrom, dateTo } = this._resolveDateRange(period, customFrom, customTo);

    let query = db('audit_selections as a')
      .join('recordings as r', 'r.id', 'a.recording_id')
      .where('a.status', 'completed')
      .whereBetween('r.file_date', [dateFrom, dateTo])
      .groupBy('a.client_code')
      .select(
        'a.client_code',
        db.raw('ROUND(AVG(NULLIF(a.score, 0)), 1) as avg_score'),
        db.raw('COUNT(*) as total')
      )
      .orderBy('avg_score', 'asc');

    if (clientCodes && clientCodes.length > 0) {
      query = query.whereIn('a.client_code', clientCodes);
    }

    const rows = await query;
    return rows.map((r) => ({
      client_code: r.client_code,
      avg_score: Number(r.avg_score),
      total: Number(r.total),
    }));
  }

  async getFailingCriteria({ period = '4w', customFrom, customTo, clientCodes }) {
    const { dateFrom, dateTo } = this._resolveDateRange(period, customFrom, customTo);

    let query = db('audit_selections as a')
      .join('recordings as r', 'r.id', 'a.recording_id')
      .join('qa_evaluations as q', 'q.recording_id', 'a.recording_id')
      .where('a.status', 'completed')
      .whereBetween('r.file_date', [dateFrom, dateTo])
      .select('q.criteria');

    if (clientCodes && clientCodes.length > 0) {
      query = query.whereIn('a.client_code', clientCodes);
    }

    const rows = await query;

    const tally = {};

    for (const row of rows) {
      let crit;
      try {
        crit = typeof row.criteria === 'string' ? JSON.parse(row.criteria) : row.criteria;
      } catch {
        continue;
      }
      if (!crit || !Array.isArray(crit.general)) continue;

      for (const item of crit.general) {
        if (item.cumple === false && item.na !== true) {
          const key = item.key || item.id || item.label || 'unknown';
          if (!tally[key]) tally[key] = { key, label: item.label || item.key || key, failures: 0 };
          tally[key].failures++;
        }
      }
    }

    return Object.values(tally)
      .sort((a, b) => b.failures - a.failures)
      .slice(0, 10);
  }

  async getStatusDistribution({ period = '4w', customFrom, customTo, clientCodes }) {
    const { dateFrom, dateTo } = this._resolveDateRange(period, customFrom, customTo);

    let query = db('audit_selections as a')
      .join('recordings as r', 'r.id', 'a.recording_id')
      .whereBetween('r.file_date', [dateFrom, dateTo])
      .groupBy('a.status')
      .select('a.status', db.raw('COUNT(*) as count'));

    if (clientCodes && clientCodes.length > 0) {
      query = query.whereIn('a.client_code', clientCodes);
    }

    const rows = await query;
    return rows.map((r) => ({ status: r.status, count: Number(r.count) }));
  }

  async getAgentRanking({ period = '4w', customFrom, customTo, clientCodes }) {
    const { dateFrom, dateTo } = this._resolveDateRange(period, customFrom, customTo);

    // Calculate prior period with same duration
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    const durationMs = to - from;
    const priorTo = new Date(from);
    priorTo.setDate(priorTo.getDate() - 1);
    const priorFrom = new Date(priorTo - durationMs);

    const priorDateFrom = priorFrom.toISOString().slice(0, 10);
    const priorDateTo = priorTo.toISOString().slice(0, 10);

    const buildQuery = (dFrom, dTo) => {
      let q = db('audit_selections as a')
        .join('recordings as r', 'r.id', 'a.recording_id')
        .where('a.status', 'completed')
        .whereBetween('r.file_date', [dFrom, dTo])
        .groupBy('a.agent_id', 'a.agent_name', 'a.client_code')
        .select(
          'a.agent_id',
          'a.agent_name',
          'a.client_code',
          db.raw('ROUND(AVG(NULLIF(a.score, 0)), 1) as avg_score'),
          db.raw('COUNT(*) as total_audits'),
          db.raw('MIN(NULLIF(a.score, 0)) as min_score'),
          db.raw('MAX(a.score) as max_score')
        );
      if (clientCodes && clientCodes.length > 0) {
        q = q.whereIn('a.client_code', clientCodes);
      }
      return q;
    };

    const [currentRows, priorRows] = await Promise.all([
      buildQuery(dateFrom, dateTo),
      buildQuery(priorDateFrom, priorDateTo),
    ]);

    // Map prior scores for quick lookup
    const priorMap = {};
    for (const r of priorRows) {
      priorMap[`${r.agent_id}__${r.client_code}`] = Number(r.avg_score);
    }

    const result = currentRows.map((r) => {
      const currentAvg = Number(r.avg_score);
      const priorAvg = priorMap[`${r.agent_id}__${r.client_code}`];
      let trend = 'neutral';
      if (priorAvg !== undefined) {
        if (currentAvg - priorAvg > 1) trend = 'up';
        else if (priorAvg - currentAvg > 1) trend = 'down';
      }
      return {
        agent_id: r.agent_id,
        agent_name: r.agent_name,
        client_code: r.client_code,
        avg_score: currentAvg,
        total_audits: Number(r.total_audits),
        min_score: Number(r.min_score),
        max_score: Number(r.max_score),
        trend,
      };
    });

    return result.sort((a, b) => a.avg_score - b.avg_score);
  }

  async getExportData(opts) {
    const [kpis, ranking, failingCriteria, statusDist] = await Promise.all([
      this.getKPIs(opts),
      this.getAgentRanking(opts),
      this.getFailingCriteria(opts),
      this.getStatusDistribution(opts),
    ]);
    return { kpis, ranking, failingCriteria, statusDist };
  }
}

module.exports = new ReportsService();
