require('dotenv').config();

// Validación de variables críticas en producción
if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET is required in production');
    process.exit(1);
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error('FATAL: GEMINI_API_KEY is required in production');
    process.exit(1);
  }
}

const config = {
  port: parseInt(process.env.PORT || '3000'),
  env: process.env.NODE_ENV || 'development',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'voxpro',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'voxpro',
  },

  // Conexión SSH al servidor donde están las grabaciones
  aware: {
    ssh: {
      host: process.env.AWARE_SSH_HOST || '10.255.255.95',
      port: parseInt(process.env.AWARE_SSH_PORT || '22'),
      username: process.env.AWARE_SSH_USER || 'tecnologia',
      password: process.env.AWARE_SSH_PASSWORD || undefined,
      privateKey: process.env.AWARE_SSH_KEY_PATH || undefined,
    },
    recordingsPath: process.env.AWARE_RECORDINGS_PATH || '/media/tecnologia/STORAGE/GRABACIONES',
    extensions: ['.wav', '.WAV', '.mp3', '.gsm', '.ogg'],
  },

  scan: {
    cronSchedule: process.env.SCAN_CRON_SCHEDULE || '0 2 * * *',
    batchSize: 500,
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: 'gemini-2.0-flash',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'voxpro-dev-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },

  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  },

  log: {
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOG_DIR || './logs',
  },
};

module.exports = config;
