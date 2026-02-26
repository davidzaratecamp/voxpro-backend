const ReportsService = require('../services/ReportsService');
const asyncHandler = require('../middleware/asyncHandler');

function extractParams(req) {
  const { period = '4w', date_from, date_to, client } = req.query;
  const clientCodes = client ? [client] : req.user.client_codes;
  return {
    period,
    customFrom: date_from || null,
    customTo: date_to || null,
    clientCodes,
  };
}

const kpis = asyncHandler(async (req, res) => {
  const opts = extractParams(req);
  const data = await ReportsService.getKPIs(opts);
  res.json({ data });
});

const weeklyTrend = asyncHandler(async (req, res) => {
  const opts = extractParams(req);
  const data = await ReportsService.getWeeklyTrend(opts);
  res.json({ data });
});

const scoreByClient = asyncHandler(async (req, res) => {
  const opts = extractParams(req);
  const data = await ReportsService.getScoreByClient(opts);
  res.json({ data });
});

const failingCriteria = asyncHandler(async (req, res) => {
  const opts = extractParams(req);
  const data = await ReportsService.getFailingCriteria(opts);
  res.json({ data });
});

const statusDistribution = asyncHandler(async (req, res) => {
  const opts = extractParams(req);
  const data = await ReportsService.getStatusDistribution(opts);
  res.json({ data });
});

const agentRanking = asyncHandler(async (req, res) => {
  const opts = extractParams(req);
  const data = await ReportsService.getAgentRanking(opts);
  res.json({ data });
});

const exportData = asyncHandler(async (req, res) => {
  const opts = extractParams(req);
  const data = await ReportsService.getExportData(opts);
  res.json({ data });
});

module.exports = { kpis, weeklyTrend, scoreByClient, failingCriteria, statusDistribution, agentRanking, exportData };
