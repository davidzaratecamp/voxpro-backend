const db = require('../database/connection');
const asyncHandler = require('../middleware/asyncHandler');

exports.list = asyncHandler(async (req, res) => {
  const clients = await db('clients')
    .select('id', 'name', 'code', 'active', 'created_at')
    .orderBy('name');
  res.json({ data: clients });
});

exports.getById = asyncHandler(async (req, res) => {
  const client = await db('clients').where({ id: req.params.id }).first();
  if (!client) {
    return res.status(404).json({ error: true, message: 'Cliente no encontrado' });
  }

  const sources = await db('aware_sources')
    .where({ client_id: client.id })
    .select('id', 'folder_name', 'active');

  res.json({ data: { ...client, sources } });
});

exports.getSources = asyncHandler(async (req, res) => {
  const sources = await db('aware_sources as s')
    .join('clients as c', 's.client_id', 'c.id')
    .select('s.id', 's.folder_name', 's.active', 'c.name as client_name', 'c.code as client_code');
  res.json({ data: sources });
});
