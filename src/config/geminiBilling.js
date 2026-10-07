// Presupuestos de Gemini por campaña (oct-2026): Claro Hogar y Claro TyT son
// campañas con recursos económicos distintos, así que cada una consume con su
// propia clave de API (un proyecto de Google con su propio tope de gasto) y
// VoxPro lleva la cuenta de lo gastado por cada una.
//
//   hogar   → Claro Hogar + Claro WCB (Hogar/Móvil/PYMES)
//   tyt     → Claro TyT (inbound/outbound) + Asiste (obama_vital)
//   general → lo demás (Obama histórico, LV, Reclutamiento)
//
// Si una clave por campaña no está configurada se usa GEMINI_API_KEY, así que
// el cambio no rompe nada mientras se crean las claves nuevas.

const GROUPS = {
  hogar:   { label: 'Claro Hogar (+ WCB)', envKey: 'GEMINI_API_KEY_HOGAR' },
  tyt:     { label: 'Claro TyT (+ Asiste)', envKey: 'GEMINI_API_KEY_TYT' },
  general: { label: 'General', envKey: 'GEMINI_API_KEY' },
};

// client_code o campaign_key → grupo
const CODE_TO_GROUP = {
  claro_hogar: 'hogar',
  claro_wcb: 'hogar',
  claro_movil: 'hogar',
  claro_pymes: 'hogar',
  claro_tyt: 'tyt',
  claro_tyt_inbound: 'tyt',
  claro_tyt_outbound: 'tyt',
  obama_vital: 'tyt',
  obama_vital_bienvenida: 'tyt',
  obama_vital_customer: 'tyt',
};

// Proyectos del bot SOFIA (asiste.awareccm.com) → grupo
const VOICEBOT_PROYECTO_TO_GROUP = { 12: 'hogar', 13: 'tyt' };

// USD por 1M de tokens (precios públicos de Google, oct-2026). Los tokens de
// "pensamiento" se cobran como salida.
const PRICES = {
  'gemini-3.1-flash-lite-preview': { text: 0.25, audio: 0.5, output: 1.5 },
  'gemini-3-flash-preview':        { text: 0.5,  audio: 1.0, output: 3.0 },
};
const DEFAULT_PRICE = PRICES['gemini-3-flash-preview'];

function groupForCode(code) {
  return CODE_TO_GROUP[code] || 'general';
}

function groupForVoicebotProyecto(proyectoId) {
  return VOICEBOT_PROYECTO_TO_GROUP[Number(proyectoId)] || 'general';
}

/** Grupo común de varios client_codes (ej. los de un usuario); si se mezclan, 'general'. */
function groupForCodes(codes = []) {
  const groups = new Set(codes.map(groupForCode));
  return groups.size === 1 ? [...groups][0] : 'general';
}

function apiKeyFor(group) {
  const cfg = GROUPS[group] || GROUPS.general;
  return process.env[cfg.envKey] || process.env.GEMINI_API_KEY || '';
}

/** Costo en USD de una respuesta de Gemini a partir de su usageMetadata. */
function costUsd(model, usage = {}) {
  const price = PRICES[model] || DEFAULT_PRICE;
  const details = usage.promptTokensDetails || [];
  const audioIn = details.filter((d) => d.modality === 'AUDIO').reduce((s, d) => s + (d.tokenCount || 0), 0);
  const textIn = Math.max(0, (usage.promptTokenCount || 0) - audioIn);
  const output = (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0);
  return {
    textIn,
    audioIn,
    output,
    usd: (textIn * price.text + audioIn * price.audio + output * price.output) / 1e6,
  };
}

module.exports = { GROUPS, groupForCode, groupForVoicebotProyecto, groupForCodes, apiKeyFor, costUsd };
