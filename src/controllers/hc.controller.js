const db = require('../database/connection');
const asyncHandler = require('../middleware/asyncHandler');

function requireSupervisor(req, res, next) {
  if (!['supervisor_calidad', 'gestor_usuarios'].includes(req.user.role)) {
    return res.status(403).json({ error: true, message: 'Acceso restringido a supervisores' });
  }
  next();
}

/**
 * GET /hc/overview?week_start=YYYY-MM-DD
 * Devuelve coordinadores del cliente del supervisor, sus agentes asignados,
 * y agentes con grabaciones esa semana que no tienen coordinador.
 */
exports.overview = asyncHandler(async (req, res) => {
  const clientCodes = req.user.client_codes || [];
  const { week_start } = req.query;

  const start = week_start || (() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay() + 1);
    return d.toISOString().slice(0, 10);
  })();
  const end = (() => {
    const d = new Date(start + 'T00:00:00');
    d.setDate(d.getDate() + 6);
    return d.toISOString().slice(0, 10);
  })();

  // 1. Coordinadores del mismo cliente (activos e inactivos)
  const coordinators = await db('users')
    .where('role', 'coordinator')
    .whereRaw(`JSON_OVERLAPS(client_codes, ?)`, [JSON.stringify(clientCodes)])
    .select('id', 'name', 'agent_ids', 'client_codes', 'active', 'campaign');

  // 2. Agentes activos en Aware esa semana
  const activeRows = await db('recordings as r')
    .join('aware_sources as s', 'r.aware_source_id', 's.id')
    .join('clients as c', 's.client_id', 'c.id')
    .whereIn('c.code', clientCodes)
    .whereBetween('r.file_date', [start, end])
    .whereNotNull('r.agent_id')
    .where('r.agent_id', '!=', '-1')
    .groupBy('r.agent_id')
    .select(
      'r.agent_id',
      db.raw('MAX(r.agent_name) as agent_name'),
      db.raw('COUNT(*) as recording_count'),
      db.raw('MAX(c.code) as client_code')
    );

  // IDs ya asignados a algún coordinador activo
  const assignedIds = new Set();
  for (const coord of coordinators.filter((c) => c.active)) {
    const ids = typeof coord.agent_ids === 'string'
      ? JSON.parse(coord.agent_ids)
      : (coord.agent_ids || []);
    ids.forEach((id) => assignedIds.add(String(id)));
  }

  // 3. Agentes sin coordinador (activos esa semana pero no asignados)
  const unassigned = activeRows
    .filter((a) => !assignedIds.has(String(a.agent_id)))
    .map((a) => ({
      agent_id: a.agent_id,
      agent_name: a.agent_name,
      recording_count: Number(a.recording_count),
      client_code: a.client_code,
    }));

  // 4. Enriquecer coordinadores con info de sus agentes
  const activeMap = {};
  for (const a of activeRows) activeMap[String(a.agent_id)] = a;

  const result = coordinators.map((coord) => {
    const ids = typeof coord.agent_ids === 'string'
      ? JSON.parse(coord.agent_ids)
      : (coord.agent_ids || []);
    const agents = ids.map((id) => {
      const active = activeMap[String(id)];
      return {
        agent_id: String(id),
        agent_name: active?.agent_name || null,
        recording_count: active ? Number(active.recording_count) : 0,
        active_this_week: !!active,
      };
    });
    return {
      id: coord.id,
      name: coord.name,
      active: !!coord.active,
      campaign: coord.campaign || null,
      client_codes: typeof coord.client_codes === 'string'
        ? JSON.parse(coord.client_codes)
        : (coord.client_codes || []),
      agents,
    };
  });

  res.json({ data: result, unassigned, week_start: start, week_end: end });
});

/**
 * PATCH /hc/coordinator/:id/agents
 * Reemplaza el agent_ids de un coordinador.
 * Body: { agent_ids: [...] }
 */
exports.updateAgents = asyncHandler(async (req, res) => {
  const clientCodes = req.user.client_codes || [];
  const coordId = parseInt(req.params.id);
  const { agent_ids } = req.body;

  if (!Array.isArray(agent_ids)) {
    return res.status(400).json({ error: true, message: 'agent_ids debe ser un array' });
  }

  // Verificar que el coordinador pertenece al cliente del supervisor
  const coord = await db('users')
    .where('id', coordId)
    .where('role', 'coordinator')
    .whereRaw(`JSON_OVERLAPS(client_codes, ?)`, [JSON.stringify(clientCodes)])
    .first();

  if (!coord) {
    return res.status(404).json({ error: true, message: 'Coordinador no encontrado' });
  }

  await db('users').where('id', coordId).update({
    agent_ids: JSON.stringify(agent_ids),
  });

  res.json({ message: 'Agentes actualizados', data: { id: coordId, agent_ids } });
});

/**
 * DELETE /hc/coordinator/:id
 * Desactiva un coordinador y libera sus agentes (quedan sin coordinador).
 */
exports.deleteCoordinator = asyncHandler(async (req, res) => {
  const clientCodes = req.user.client_codes || [];
  const coordId = parseInt(req.params.id);

  const coord = await db('users')
    .where('id', coordId)
    .where('role', 'coordinator')
    .whereRaw(`JSON_OVERLAPS(client_codes, ?)`, [JSON.stringify(clientCodes)])
    .first();

  if (!coord) {
    return res.status(404).json({ error: true, message: 'Coordinador no encontrado' });
  }

  await db('users').where('id', coordId).update({
    active: 0,
    agent_ids: JSON.stringify([]),
  });

  res.json({ message: `Coordinador ${coord.name} desactivado y agentes liberados` });
});

/**
 * GET /hc/coordinators
 * Lista ligera de coordinadores activos del cliente (para dropdowns).
 */
exports.listCoordinators = asyncHandler(async (req, res) => {
  const clientCodes = req.user.client_codes || [];

  const coordinators = await db('users')
    .where('role', 'coordinator')
    .where('active', 1)
    .whereRaw(`JSON_OVERLAPS(client_codes, ?)`, [JSON.stringify(clientCodes)])
    .select('id', 'name', 'agent_ids', 'campaign');

  const result = coordinators.map((c) => ({
    id: c.id,
    name: c.name,
    campaign: c.campaign || null,
    agent_ids: typeof c.agent_ids === 'string'
      ? JSON.parse(c.agent_ids)
      : (c.agent_ids || []),
  }));

  res.json({ data: result });
});

/**
 * PATCH /hc/coordinator/:id/campaign
 * Actualiza la campaña de un coordinador.
 * Body: { campaign: 'ventas' | 'customer' | null }
 */
exports.updateCampaign = asyncHandler(async (req, res) => {
  const clientCodes = req.user.client_codes || [];
  const coordId = parseInt(req.params.id);
  const { campaign } = req.body;

  const validCampaigns = ['ventas', 'customer', null];
  if (!validCampaigns.includes(campaign)) {
    return res.status(400).json({ error: true, message: 'Campaña inválida. Valores: ventas, customer, null' });
  }

  const coord = await db('users')
    .where('id', coordId)
    .where('role', 'coordinator')
    .whereRaw(`JSON_OVERLAPS(client_codes, ?)`, [JSON.stringify(clientCodes)])
    .first();

  if (!coord) {
    return res.status(404).json({ error: true, message: 'Coordinador no encontrado' });
  }

  await db('users').where('id', coordId).update({ campaign: campaign || null });

  res.json({ message: 'Campaña actualizada', data: { id: coordId, campaign } });
});

exports.requireSupervisor = requireSupervisor;
