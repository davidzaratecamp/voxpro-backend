// Conexión al Aware de Obama Vital (asiste2.awareccm.com) — la operación de
// Obama reestructurada en septiembre 2026. Reemplaza a los Aware estándar
// AWARE_30/31/5/32, que quedan solo como histórico del cliente "obama".
// Igual que el Aware de SOFIA, se alcanza directo (sin túnel por Kraken).
//
// Es un cliente distinto de "lv" (Vital Health) y de "obama": tiene su propio
// client_code, su propio rol (auditor_obama_vital) y sus propias matrices.

module.exports = {
  clientCode: 'obama_vital',
  db: {
    host: process.env.OBAMA_VITAL_DB_HOST || 'asiste2.awareccm.com',
    port: parseInt(process.env.OBAMA_VITAL_DB_PORT || '5432'),
    database: process.env.OBAMA_VITAL_DB_NAME || 'awareccm',
    user: process.env.OBAMA_VITAL_DB_USER || 'analista',
    password: process.env.OBAMA_VITAL_DB_PASSWORD || '',
  },
  audioBaseUrl: 'https://asiste2.awareccm.com/audiofiles',
  // Cada campaña tiene su propia matriz en criteria_configs (campaign_key).
  // Los nombres de proyecto son los del dashboard de Aware.
  campaigns: {
    bienvenida: {
      key: 'obama_vital_bienvenida',
      label: 'Bienvenida',
      proyectos: { 10: 'Bienvenida 1', 11: 'Bienvenida 2' },
    },
    customer: {
      key: 'obama_vital_customer',
      label: 'ObamaCus',
      proyectos: { 2: 'ObamaCus1', 4: 'ObamaCus2', 5: 'ObamaCus3', 6: 'ObamaCus4' },
    },
  },
};
