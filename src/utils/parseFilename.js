const path = require('path');

/**
 * Parsea el nombre de archivo de una grabación Aware para extraer metadatos.
 *
 * Patrones detectados:
 *   Q-13467929017-487910.WAV    → llamada de cola (queue), teléfono: 13467929017
 *   17865972897-101090.WAV      → llamada directa, teléfono: 17865972897
 *   1001271499-1770135207.245436.WAV → llamada con timestamp aware
 *   00-1770135516.246100.WAV    → grabación interna/sistema
 *   3003213722-1742223726.1575.WAV → llamada con ID de sesión
 *
 * @param {string} fileName - Nombre del archivo (sin ruta)
 * @returns {object} Metadatos extraídos
 */
function parseFilename(fileName) {
  const baseName = path.basename(fileName, path.extname(fileName));
  const result = {
    isQueueCall: false,
    phone: null,
    callId: null,
    rawName: baseName,
  };

  let workName = baseName;

  // Detectar prefijo Q- (llamada de cola/queue)
  if (workName.startsWith('Q-')) {
    result.isQueueCall = true;
    workName = workName.substring(2);
  }

  // Separar por guión: primer segmento = teléfono, segundo = ID
  const parts = workName.split('-');
  if (parts.length >= 2) {
    result.phone = parts[0];
    result.callId = parts.slice(1).join('-');
  } else {
    result.callId = workName;
  }

  return result;
}

module.exports = parseFilename;
