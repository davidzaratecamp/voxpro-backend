/**
 * Coincidencia difusa de nombres de agente — misma regla que usa el escaneo de
 * Zoom de Obama (ZoomScannerService._autoMatchAgent): tokens de más de 2 letras,
 * sin tildes; un candidato vale si comparte ≥2 tokens y ≥50% de los tokens del
 * nombre más largo.
 *
 * Dos reglas más estrictas, para no atribuirle a un agente las llamadas de otro:
 *  - del nombre que se busca, como mucho UNA palabra puede faltar en el
 *    candidato ("Laura Valentina Perea Avendaño" NO es "Ladino Quintero Laura
 *    Valentina": le faltan "perea" y "avendano"; "Laura Ladino" sí lo es);
 *  - si dos candidatos empatan en el mejor puntaje no se elige ninguno.
 */

const normalize = (str) =>
  String(str || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ');

const tokens = (name) => normalize(name).split(/\s+/).filter((t) => t.length > 2);

/**
 * @param {string} name
 * @param {Array<{id: string, name: string}>} candidates
 * @returns {{id: string, name: string, score: number} | null}
 */
function bestNameMatch(name, candidates) {
  const own = tokens(name);
  if (!own.length) return null;

  let best = null;
  let tie = false;
  for (const c of candidates) {
    const cand = tokens(c.name);
    const overlap = own.filter((t) => cand.includes(t)).length;
    const score = overlap / Math.max(own.length, cand.length);
    if (overlap < 2 || score < 0.5 || own.length - overlap > 1) continue;
    if (!best || score > best.score) {
      best = { ...c, score };
      tie = false;
    } else if (score === best.score && c.id !== best.id) {
      tie = true;
    }
  }
  return best && !tie ? best : null;
}

module.exports = { bestNameMatch };
