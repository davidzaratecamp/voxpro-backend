require('dotenv').config();

const app = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const db = require('./database/connection');
const scheduler = require('./jobs/scheduler');

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
  app.listen(config.port, () => {
    logger.info(`VoxPro API corriendo en puerto ${config.port} [${config.env}]`);
  });

  // Iniciar scheduler de escaneo nocturno
  scheduler.start();
}

// Shutdown limpio
process.on('SIGTERM', async () => {
  logger.info('SIGTERM recibido, cerrando...');
  scheduler.stop();
  await db.destroy();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT recibido, cerrando...');
  scheduler.stop();
  await db.destroy();
  process.exit(0);
});

start();
