require('dotenv').config();

const app = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const db = require('./database/connection');

async function start() {
  // Verificar conexión a base de datos
  try {
    await db.raw('SELECT 1');
    logger.info('Conexión a MySQL establecida');
  } catch (err) {
    logger.error('No se pudo conectar a MySQL', err);
    process.exit(1);
  }

  // Iniciar servidor HTTP
  // Timeout extendido (20 min) para análisis de grabaciones largas con Gemini
  const server = app.listen(config.port, () => {
    logger.info(`VoxPro API corriendo en puerto ${config.port} [${config.env}]`);
  });
  server.timeout = 20 * 60 * 1000;
}

// Shutdown limpio
process.on('SIGTERM', async () => {
  logger.info('SIGTERM recibido, cerrando...');
  await db.destroy();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT recibido, cerrando...');
  await db.destroy();
  process.exit(0);
});

start();
