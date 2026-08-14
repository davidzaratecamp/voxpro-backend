// Conexión al servidor Aware del voicebot de Claro (asiste.awareccm.com).
// A diferencia de los demás servidores Aware (10.255.255.x), este es
// alcanzable directamente por HTTPS/Postgres, sin túnel SSH por Kraken.

module.exports = {
  db: {
    host: process.env.VOICEBOT_DB_HOST || 'asiste.awareccm.com',
    port: parseInt(process.env.VOICEBOT_DB_PORT || '5432'),
    database: process.env.VOICEBOT_DB_NAME || 'awareccm',
    user: process.env.VOICEBOT_DB_USER || 'analista',
    password: process.env.VOICEBOT_DB_PASSWORD || '',
  },
  audioBaseUrl: 'https://asiste.awareccm.com/audiofiles',
  proyectos: {
    12: 'Claro Hogar',
    13: 'Claro TyT',
  },
};
