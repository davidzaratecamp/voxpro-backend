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
  clientCodeToProyecto: {
    claro_hogar: 12,
    claro_tyt: 13,
  },
  // Colas de agentes humanos donde aterrizan las transferencias de SOFIA
  // (misma base de datos, proyecto_id distinto al del bot). Nombres reales
  // según json_data.proyecto_name: 7="Inb Hogar IA", 9="Inb Hogar IA 2",
  // 10="Inb T&T IA", 11="Inb T&T IA 2".
  humanProyectos: {
    7: 'claro_hogar',
    9: 'claro_hogar',
    10: 'claro_tyt',
    11: 'claro_tyt',
  },
};
