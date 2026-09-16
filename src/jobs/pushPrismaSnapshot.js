const SofiaQualityService = require('../services/SofiaQualityService');
const logger = require('../utils/logger');

/**
 * Empuja el snapshot de calidad IA de SOFIA al panel de Prisma.
 * VoxPro tiene salida a internet; los dos servidores no se ven entre sí por
 * HTTP, así que el flujo es push (VoxPro → Prisma), no pull.
 *
 * Prisma tiene analistas con alcance de campaña (solo Hogar o solo TyT), así
 * que no basta con mandar un combinado: se calculan las 3 variantes
 * (ambas / solo Hogar / solo TyT) y Prisma elige la que corresponde al
 * alcance del usuario que pide el panel. `getQuality` ya soporta el filtro
 * `proyectos` — aquí solo se llama 3 veces.
 */
async function pushPrismaSnapshot() {
  const url = process.env.PRISMA_SNAPSHOT_URL;
  const token = process.env.PRISMA_ANALYTICS_TOKEN;
  if (!url || !token) return;

  try {
    const [all, hogar, tyt] = await Promise.all([
      SofiaQualityService.getQuality({ days: 30, proyectos: [12, 13] }),
      SofiaQualityService.getQuality({ days: 30, proyectos: [12] }),
      SofiaQualityService.getQuality({ days: 30, proyectos: [13] }),
    ]);
    const payload = {
      generated_at: all.generated_at,
      range_days: all.range_days,
      variants: { all, 12: hogar, 13: tyt },
    };
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
