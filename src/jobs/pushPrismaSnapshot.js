const SofiaQualityService = require('../services/SofiaQualityService');
const logger = require('../utils/logger');

/**
 * Empuja el snapshot de calidad IA de SOFIA al panel de Prisma.
 * VoxPro tiene salida a internet; los dos servidores no se ven entre sí por
 * HTTP, así que el flujo es push (VoxPro → Prisma), no pull.
 */
async function pushPrismaSnapshot() {
  const url = process.env.PRISMA_SNAPSHOT_URL;
  const token = process.env.PRISMA_ANALYTICS_TOKEN;
  if (!url || !token) return;

  try {
    const payload = await SofiaQualityService.getQuality({ days: 30 });
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      logger.error(`push snapshot Prisma: HTTP ${res.status}`);
      return;
    }
    logger.info('push snapshot Prisma: ok');
  } catch (err) {
    logger.error('push snapshot Prisma: error', err.message || err);
  }
}

module.exports = pushPrismaSnapshot;
