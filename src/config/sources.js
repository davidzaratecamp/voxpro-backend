// Mapeo de carpetas Aware a clientes y sus bases de datos PostgreSQL.
// Cada servidor Aware tiene su propia DB con datos de llamadas y agentes.
// La conexión se hace vía túnel SSH a través de Kraken.

// Credenciales desde variables de entorno (3 grupos)
const group1User = process.env.AWARE_DB_USER_GROUP1 || 'analista';
const group1Pass = process.env.AWARE_DB_PASS_GROUP1 || '';
const group2User = process.env.AWARE_DB_USER_GROUP2 || 'analista';
const group2Pass = process.env.AWARE_DB_PASS_GROUP2 || '';
const group3User = process.env.AWARE_DB_USER_GROUP3 || 'analista';
const group3Pass = process.env.AWARE_DB_PASS_GROUP3 || '';

const AWARE_SOURCES = [
  // LV (Vital Health) - comparte SFTP AWARE_30 con Obama, distinguido por proyecto_id (34=ventas, 35=customer)
  {
    folder: 'AWARE_30',
    clientCode: 'lv',
    clientName: 'LV Vital Health',
    db: { host: '10.255.255.30', database: 'aware', user: group1User, password: group1Pass, port: 5432 },
    schema: 'standard',
    audioBaseUrl: 'https://10.255.255.30/audiofiles',
  },

  // Obama - 3 carpetas, 3 servidores distintos
  {
    folder: 'AWARE_30',
    clientCode: 'obama',
    clientName: 'Obama',
    db: { host: '10.255.255.30', database: 'aware', user: group1User, password: group1Pass, port: 5432 },
    schema: 'standard',
    audioBaseUrl: 'https://10.255.255.30/audiofiles',
  },
  {
    folder: 'AWARE_31',
    clientCode: 'obama',
    clientName: 'Obama',
    db: { host: '10.255.255.31', database: 'aware', user: group1User, password: group1Pass, port: 5432 },
    schema: 'standard',
    audioBaseUrl: 'https://10.255.255.31/audiofiles',
  },
  {
    folder: 'AWARE_5',
    clientCode: 'obama',
    clientName: 'Obama',
    db: { host: '10.255.255.5', database: 'aware', user: group1User, password: group1Pass, port: 5432 },
    schema: 'standard',
    audioBaseUrl: 'https://10.255.255.5/audiofiles',
  },
  {
    folder: 'AWARE_32',
    clientCode: 'obama',
    clientName: 'Obama',
    db: { host: '10.255.255.32', database: 'aware', user: group1User, password: group1Pass, port: 5432 },
    schema: 'standard',
    audioBaseUrl: 'https://10.255.255.32/audiofiles',
  },

  // Claro TYT - migrado completamente a AWARE_8
  {
    folder: 'AWARE_8',
    clientCode: 'claro_tyt',
    clientName: 'Claro TYT',
    db: { host: '10.255.255.8', database: 'aware', user: group1User, password: group1Pass, port: 5432 },
    schema: 'standard',
    audioBaseUrl: 'https://10.255.255.8/audiofiles',
  },

  // Claro Hogar
  {
    folder: 'AWARE_4',
    clientCode: 'claro_hogar',
    clientName: 'Claro Hogar',
    db: { host: '10.255.255.4', database: 'aware', user: group2User, password: group2Pass, port: 5432 },
    schema: 'standard',
    audioBaseUrl: 'https://10.255.255.4/audiofiles',
  },

  // Claro WCB - esquema diferente
  {
    folder: 'AWARE_34CCM',
    clientCode: 'claro_wcb',
    clientName: 'Claro WCB',
    db: { host: '10.255.255.34', database: 'awareccm', user: group2User, password: group2Pass, port: 5432 },
    schema: 'awareccm',
    audioBaseUrl: 'https://10.255.255.34/audiofiles',
  },

  // Reclutamiento - AWARE_6 compartido, filtrado por anexo de cada reclutadora
  {
    folder: 'AWARE_6',
    clientCode: 'reclutamiento',
    clientName: 'Reclutamiento',
    db: { host: '10.255.255.6', database: 'aware', user: group1User, password: group1Pass, port: 5432 },
    schema: 'standard',
    audioBaseUrl: 'https://10.255.255.6/audiofiles',
    filterByAnexos: ['4002', '4007', '4012', '4016'],
  },
];

module.exports = AWARE_SOURCES;
