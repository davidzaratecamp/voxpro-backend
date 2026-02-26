const StatsService = require('../services/StatsService');
const asyncHandler = require('../middleware/asyncHandler');

exports.overview = asyncHandler(async (req, res) => {
  const stats = await StatsService.overview();
  res.json({ data: stats });
});

exports.byClient = asyncHandler(async (req, res) => {
  const stats = await StatsService.byClient();
  res.json({ data: stats });
});

exports.daily = asyncHandler(async (req, res) => {
  const { date_from, date_to, client } = req.query;
  const stats = await StatsService.daily({
    dateFrom: date_from,
    dateTo: date_to,
    clientCode: client,
  });
  res.json({ data: stats });
});

exports.agents = asyncHandler(async (req, res) => {
  const { client } = req.query;
  const agents = await StatsService.agents({ clientCode: client });
  res.json({ data: agents, count: agents.length });
});

exports.jobHistory = asyncHandler(async (req, res) => {
  const { limit } = req.query;
  const jobs = await StatsService.jobHistory({
    limit: parseInt(limit) || 20,
  });
  res.json({ data: jobs });
});
