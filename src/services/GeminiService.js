const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require('@google/generative-ai/server');
const os = require('os');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const { OBAMA_CUSTOMER_AGENTS, LV_CUSTOMER_PROYECTO } = require('../config/evaluationCriteria');
const CriteriaService = require('./CriteriaService');
const {
  SECTION_ROLE_DEFINITION,
  SECTION_TRANSCRIPTION_TASK,
  SECTION_EVALUATION_PHILOSOPHY,
  SECTION_HIGH_IMPACT_RULES,
  SECTION_NA_RULES,
  SECTION_DROPPED_CALL_RULE,
  SECTION_THIRD_PARTY_RULE,
  SECTION_ADDITIONAL_RULES,
  SECTION_SCORE_CALC,
} = require('../config/promptSections');

/**
 * Semáforo de concurrencia: permite hasta MAX_CONCURRENT análisis simultáneos a Gemini.
 * Los demás esperan en cola en lugar de fallar con 429.
 * Cada slot "pasa" directamente al siguiente en espera cuando se libera.
 */
class Semaphore {
  constructor(max) {
    this.max = max;
    this.running = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.running < this.max) {
      this.running++;
      return;
    }
    logger.info(`Gemini queue: ${this.queue.length + 1} esperando slot (${this.running}/${this.max} en uso)`);
    await new Promise((resolve) => this.queue.push(resolve));
  }

  release() {
    if (this.queue.length > 0) {
      // Pasa el slot directamente al siguiente en espera (running no cambia)
      const next = this.queue.shift();
      next();
    } else {
      this.running--;
    }
  }
}

const MAX_CONCURRENT = 3;

/**
 * Mapea (clientCode, agentId, proyectoId) → campaign_key string.
 * Los criterios de routing (Obama customer vs ventas, LV customer vs ventas)
 * permanecen aquí — son lógica de routing, no datos de criterios.
 */
function resolveCampaignKey(clientCode, agentId, proyectoId) {
  if (clientCode === 'obama') {
    return agentId && OBAMA_CUSTOMER_AGENTS.has(String(agentId))
      ? 'obama_customer'
      : 'obama_ventas';
  }
  if (clientCode === 'lv') {
    return proyectoId === LV_CUSTOMER_PROYECTO ? 'lv_customer' : 'lv_ventas';
  }
  return clientCode; // claro_wcb, claro_hogar, claro_tyt
}

class GeminiService {
  constructor() {
    this.genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    this.model = this.genAI.getGenerativeModel({ model: config.gemini.model });
    this.fileManager = new GoogleAIFileManager(config.gemini.apiKey);
    this.semaphore = new Semaphore(MAX_CONCURRENT);
  }

  /**
   * Analiza un audio de llamada: transcribe y evalúa según criterios del cliente.
   * @param {Buffer} audioBuffer - Contenido WAV del archivo
   * @param {string} clientCode - Código del cliente
   * @param {string} [agentId] - Cédula del agente (para Obama: distingue Ventas vs Customer)
   * @param {number} [proyectoId] - ID del proyecto en Aware (para LV: distingue Ventas vs Customer)
   * @returns {{ transcription: string, evaluation: object }}
   */
  async analyzeCall(audioBuffer, clientCode, agentId, proyectoId) {
    const campaignKey = resolveCampaignKey(clientCode, agentId, proyectoId);
    const criteria = await CriteriaService.getByKey(campaignKey);

    await this.semaphore.acquire();
    try {
      return await this._doAnalyzeCall(audioBuffer, criteria);
    } finally {
      this.semaphore.release();
    }
  }

  async _doAnalyzeCall(audioBuffer, criteria) {
    const prompt = this._buildPrompt(criteria);
    const sizeKB = (audioBuffer.length / 1024).toFixed(0);
    logger.info(`Subiendo audio a Gemini File API (${sizeKB} KB) para ${criteria.label}`);

    // Subir el audio como archivo (evita las restricciones de inlineData en producción)
    const tmpPath = path.join(os.tmpdir(), `vxpro_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp3`);
    let uploadedFileName = null;
    try {
      fs.writeFileSync(tmpPath, audioBuffer);
      const uploadResponse = await this.fileManager.uploadFile(tmpPath, {
        mimeType: 'audio/mpeg',
        displayName: `voxpro_audio_${Date.now()}`,
      });
      uploadedFileName = uploadResponse.file.name;
      const fileUri = uploadResponse.file.uri;
      logger.info(`Audio subido: ${uploadedFileName}`);

      return await this._retryWithBackoff(async () => {
        const result = await this.model.generateContent([
          { fileData: { mimeType: 'audio/wav', fileUri } },
          { text: prompt },
        ]);
        const response = result.response.text();
        logger.debug('Respuesta Gemini recibida', { length: response.length });
        return this._parseResponse(response, criteria);
      });
    } finally {
      try { fs.unlinkSync(tmpPath); } catch {}
      if (uploadedFileName) {
        this.fileManager.deleteFile(uploadedFileName).catch(() => {});
      }
    }
  }

  /**
   * Retry con backoff exponencial para errores transitorios.
   * Para 429 (rate limit) usa delays largos: 30s, 60s, 120s.
   * Para otros errores transitorios usa delays cortos: 2s, 4s, 8s.
   */
  async _retryWithBackoff(fn, maxRetries = 5) {
    const RETRIABLE_CODES = [429, 500, 503];
    const RETRIABLE_ERRORS = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'];
    // Delays fijos para rate limit: 15s, 30s, 45s, 60s, 90s
    const RATE_LIMIT_DELAYS = [15000, 30000, 45000, 60000, 90000];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const status = err.status || err.httpStatusCode || err.code;
        const isRateLimit = status === 429 || err.message?.includes('429') || err.message?.includes('Resource exhausted');
        const isJsonError = err.message?.includes('JSON') || err.message?.includes('no es JSON válido');
        const isRetriable =
          RETRIABLE_CODES.includes(status) ||
          RETRIABLE_ERRORS.includes(err.code) ||
          err.message?.includes('timeout') ||
          isRateLimit ||
          isJsonError;

        if (!isRetriable || attempt === maxRetries) {
          throw err;
        }

        // Rate limit: delays fijos (15s, 30s, 45s, 60s, 90s)
        // JSON truncado/inválido: backoff corto (2s, 4s, 8s) — puede ser problema de red
        // Otros errores transitorios: backoff corto (2s, 4s, 8s)
        const delay = isRateLimit
          ? RATE_LIMIT_DELAYS[attempt] ?? 90000
          : Math.pow(2, attempt + 1) * 1000;

        logger.warn(
          `Gemini API error (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay / 1000}s`,
          { status, code: err.code, message: err.message }
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Construye el prompt de evaluación con los criterios del cliente.
   */
  _buildPrompt(criteria) {
    const generalList = criteria.general
      .map((c) => {
        const desc = c.description?.trim() ? `\n    → ${c.description}` : '';
        return `  - "${c.key}" (${c.label}): peso ${c.weight}%${desc}`;
      })
      .join('\n');

    const hiList = criteria.highImpact
      .map((c) => {
        const desc = c.description?.trim() ? `\n    → ${c.description}` : '';
        return `  - "${c.key}" (${c.label})${desc}`;
      })
      .join('\n');

    const specialBlock = (() => {
      const si = criteria.specialInstructions;
      if (!si || si.length === 0) return '';
      if (Array.isArray(si)) {
        const items = si.filter((s) => s.body?.trim());
        if (items.length === 0) return '';
        return `## INSTRUCCIONES ADICIONALES\n${items.map((s) => `### ${s.title}\n${s.body}`).join('\n\n')}`;
      }
      return `## INSTRUCCIONES ADICIONALES\n${si}`;
    })();

    const sections = [
      SECTION_ROLE_DEFINITION,
      SECTION_TRANSCRIPTION_TASK,
      `## TAREA 2: EVALUACIÓN — ${criteria.label}`,
      `### Criterios Generales:\n${generalList}`,
      `### Ítems de Alto Impacto (cumplimiento obligatorio):\n${hiList}`,
      SECTION_EVALUATION_PHILOSOPHY,
      SECTION_HIGH_IMPACT_RULES,
      SECTION_NA_RULES,
      SECTION_DROPPED_CALL_RULE,
      SECTION_THIRD_PARTY_RULE,
      SECTION_ADDITIONAL_RULES,
      SECTION_SCORE_CALC,
      specialBlock,
      this._buildResponseFormat(criteria),
    ].filter(Boolean);

    return sections.join('\n\n');
  }

  /**
   * Builds the dynamic FORMATO DE RESPUESTA section with the per-campaign JSON schema.
   */
  _buildResponseFormat(criteria) {
    return `## FORMATO DE RESPUESTA
Responde EXCLUSIVAMENTE en JSON válido con esta estructura exacta (sin markdown, sin texto antes ni después):

{
  "call_unintelligible": false,
  "transcription": "Agente: ... \\nCliente: ... \\n...",
  "general": {
${criteria.general.map((item) => `    "${item.key}": { "cumple": true, "na": false, "observacion": "breve justificación", "cita": "", "timestamp": 0 }`).join(',\n')}
  },
  "high_impact": {
${criteria.highImpact.map((item) => `    "${item.key}": { "cumple": true, "observacion": "breve justificación", "cita": "", "timestamp": 0 }`).join(',\n')}
  },
  "resumen": "Resumen ejecutivo de 2-3 oraciones sobre el desempeño general del agente"
}

IMPORTANTE:
- En "general", usa "na": true cuando el criterio No Aplica. Si "na" es true, el valor de "cumple" se ignora.
- El campo "cita" es OBLIGATORIO cuando "cumple" es false (y "na" es false). Debe contener un fragmento EXACTO y LITERAL de la transcripción que evidencia por qué no cumple. Copia el texto tal cual aparece en la transcripción, sin modificarlo. Si el incumplimiento es por OMISIÓN (el agente no dijo algo que debía decir), deja "cita" vacío y explícalo en "observacion".
- Para items de alto impacto que NO cumplen, también incluye la "cita" exacta de la transcripción.
- El campo "timestamp" es OBLIGATORIO para TODOS los criterios (generales y alto impacto). Indica el segundo aproximado del audio donde se evidencia el cumplimiento o incumplimiento del criterio. Si el criterio se evalúa al inicio de la llamada (ej: saludo), el timestamp será bajo (ej: 5). Si es al final (ej: cierre), será alto. Si es por OMISIÓN (algo que nunca se dijo), usa el timestamp del momento donde DEBERÍA haberse dicho. El valor debe ser un número entero en segundos desde el inicio del audio.

- Si \`call_unintelligible\` es true, los demás campos igualmente deben estar presentes con valores por defecto; el sistema asignará score 100 automáticamente.

Responde SOLO el JSON. No incluyas \`\`\`json ni ningún otro texto.`;
  }

  /**
   * Parsea la respuesta de Gemini y calcula el score.
   */
  _parseResponse(responseText, criteria) {
    // Limpiar posibles delimitadores markdown
    let cleaned = responseText.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      logger.error('Error parseando respuesta de Gemini', { response: cleaned.slice(0, 500) });
      throw new Error('La respuesta de Gemini no es JSON válido');
    }

    // Post-procesamiento: detectar grabación ininteligible → score 100
    if (parsed.call_unintelligible === true) {
      logger.info('Grabación ininteligible detectada, asignando score 100');
      this._applyUnintelligibleCallOverride(parsed, criteria);
      const { generalResults, highImpactResults } = this._calculateScore(parsed, criteria);
      return {
        transcription: parsed.transcription || '',
        evaluation: {
          score: 100,
          general: generalResults,
          highImpact: highImpactResults,
          highImpactFailed: false,
          callUnintelligible: true,
          summary: parsed.resumen || '',
        },
      };
    }

    // Post-procesamiento: detectar tercero y forzar N/A en criterios del titular
    this._applyThirdPartyOverride(parsed, criteria);

    // Post-procesamiento: detectar llamada cortada y forzar N/A en criterios de cierre
    this._applyDroppedCallOverride(parsed, criteria);

    // Post-procesamiento: detectar rechazo explícito del cliente y forzar N/A en fases no alcanzadas
    this._applyRejectionOverride(parsed, criteria);

    // Post-procesamiento: forzar N/A en manejo_objeciones si no hubo objeción
    this._applyNoObjectionOverride(parsed, criteria);

    // Post-procesamiento: forzar N/A en criterios no verificables por audio
    this._applyUnverifiableOverride(parsed, criteria);

    // Post-procesamiento: aplicar grupos N/A personalizados definidos por el supervisor
    this._applyCustomGroupOverrides(parsed, criteria);

    // Post-procesamiento: detectar groserías del agente → forzar maltrato_cliente = no cumple
    this._applyProfanityOverride(parsed);

    // Calcular score
    const { score, generalResults, highImpactResults, highImpactFailed } =
      this._calculateScore(parsed, criteria);

    return {
      transcription: parsed.transcription || '',
      evaluation: {
        score,
        general: generalResults,
        highImpact: highImpactResults,
        highImpactFailed,
        summary: parsed.resumen || '',
      },
    };
  }

  /**
   * Cuando la grabación es ininteligible por fallo técnico, fuerza todos los
   * criterios generales a N/A y todos los de alto impacto a cumple: true,
   * para que el score resultante sea 100 (sin penalizar al agente).
   */
  _applyUnintelligibleCallOverride(parsed, criteria) {
    const msg = 'N/A — grabación ininteligible o defectuosa, no es atribuible al agente';

    if (parsed.general) {
      for (const item of criteria.general) {
        if (!parsed.general[item.key]) parsed.general[item.key] = {};
        parsed.general[item.key].na = true;
        parsed.general[item.key].cumple = false;
        parsed.general[item.key].observacion = msg;
        parsed.general[item.key].cita = '';
        parsed.general[item.key].timestamp = 0;
      }
    }

    if (parsed.high_impact) {
      for (const item of criteria.highImpact) {
        if (!parsed.high_impact[item.key]) parsed.high_impact[item.key] = {};
        parsed.high_impact[item.key].cumple = true;
        parsed.high_impact[item.key].observacion = msg;
        parsed.high_impact[item.key].cita = '';
        parsed.high_impact[item.key].timestamp = 0;
      }
    }
  }

  /**
   * Detecta si la llamada fue atendida por un tercero (no el titular)
   * y fuerza N/A en los criterios que dependen de hablar con el titular.
   * Usa criteria.naRules.third_party desde la DB.
   */
  _applyThirdPartyOverride(parsed, criteria) {
    const transcription = (parsed.transcription || '').toLowerCase();

    const thirdPartyPatterns = [
      /no soy yo/,
      /es mi (hija|hijo|esposo|esposa|mamá|papá|madre|padre|hermano|hermana|señora|señor)/,
      /no vive conmigo/,
      /no (está|se encuentra)/,
      /ella no está|él no está/,
      /no es (el|la) titular/,
      /yo no soy/,
      /pero no soy/,
      /esa persona no/,
      /no la conozco|no lo conozco/,
    ];

    const isThirdParty = thirdPartyPatterns.some((pattern) => pattern.test(transcription));
    if (!isThirdParty) return;

    const keys = new Set(criteria.naRules?.third_party || []);
    if (keys.size === 0) return;

    logger.info('Tercero detectado en transcripción, forzando N/A en criterios del titular');

    if (parsed.general) {
      for (const key of keys) {
        if (parsed.general[key] && !parsed.general[key].na) {
          parsed.general[key].na = true;
          parsed.general[key].observacion = 'N/A — llamada atendida por tercero, no el titular';
        }
      }
    }
  }

  /**
   * Detecta si la llamada fue cortada prematuramente y fuerza N/A en criterios
   * de cierre/fases finales. Usa criteria.naRules.dropped_call desde la DB.
   */
  _applyDroppedCallOverride(parsed, criteria) {
    const transcription = (parsed.transcription || '');
    const lines = transcription.split('\n').filter((l) => l.trim());

    // --- Detección 1: cliente dice explícitamente que está ocupado/no puede ---
    const droppedPatterns = [
      /estoy.{0,20}ocupad[ao]/,
      /ando.{0,20}ocupad[ao]/,
      /me encuentro.{0,20}ocupad[ao]/,
      /no (puedo|tengo tiempo) (ahorita|ahora|en este momento)/,
      /me puede[n|s]? (llamar|marcar|contactar) (después|luego|más tarde|en una hora|en un rato|mañana|otro día|otra vez)/,
      /pueden (llamarme|contactarme|marcarme) (después|luego|más tarde|mañana|otro día)/,
      /llám[ae]me (después|luego|más tarde|mañana|otro día|en un rato)/,
      /llámenme (después|luego|más tarde|mañana)/,
      /me (llamen|llaman|contacten|marquen) (después|luego|más tarde|mañana|otro día)/,
      /estoy (en el )?trabaj(o|ando)/,
      /estoy manejando/,
      /no es buen momento/,
      /no puedo hablar (ahorita|ahora|en este momento)/,
      /estoy en (una )?reuni[oó]n/,
      /llame.*más tarde|llámeme.*más tarde|llámenme.*después/,
      /después (me|nos) (llaman|llame|contactan|marcan)/,
      /al rato (me|nos) (llaman|llame|contactan)/,
      /no (tengo|puedo|estoy) (disponible|libre) (ahora|ahorita|en este momento)/,
      /no tengo tiempo (ahora|ahorita|en este momento|para esto)/,
      /después hablamos|después les llamo|después los llamo/,
      /en otro momento/,
      /no me (moleste|molesten|llame|llamen) (ahora|ahorita|más)/,
      /yo (le|les|los|la) (marco|llamo|contacto) (después|luego|más tarde|cuando pueda|en un rato)/,
      /cuando (pueda|tenga tiempo|esté libre).{0,20}(llamo|marco|contacto)/,
      /ahorita.{0,30}ocupad[ao]/,
      /no (le |les )?puedo (atender|hablar) (ahora|ahorita)/,
    ];
    const clientLines = lines
      .filter((l) => /^Cliente:/i.test(l))
      .map((l) => l.replace(/^Cliente:\s*/i, '').toLowerCase())
      .join(' ');
    const clientWantedToLeave = droppedPatterns.some((p) => p.test(clientLines));

    // --- Detección 2: corte abrupto — no hay despedida y el agente habla al final ---
    const farewell = /gracias|hasta luego|chao|adiós|bye|que (le |te )?vaya bien|fue un placer|con mucho gusto/;
    const lastFiveLines = lines.slice(-5).join(' ').toLowerCase();
    const hadAnyFarewell = farewell.test(lastFiveLines);
    const lastLine = lines[lines.length - 1] || '';
    const callEndedAbruptly = !hadAnyFarewell && /^Agente:/i.test(lastLine) && lines.length >= 3;

    if (!clientWantedToLeave && !callEndedAbruptly) return;

    if (!clientWantedToLeave) {
      const lastClientLine = [...lines].reverse().find((l) => /^Cliente:/i.test(l));
      const hadNormalGoodbye = farewell.test(lastClientLine?.toLowerCase() || '');
      if (hadNormalGoodbye) return;
    }

    logger.info(
      `Llamada cortada detectada (${callEndedAbruptly ? 'corte abrupto' : 'cliente ocupado'}), ` +
      'forzando N/A en criterios de cierre/fases finales'
    );

    const closureKeys = new Set(criteria.naRules?.dropped_call || []);
    if (closureKeys.size === 0) return;

    if (parsed.general) {
      for (const key of closureKeys) {
        if (parsed.general[key] && !parsed.general[key].na) {
          if (!parsed.general[key].cumple) {
            parsed.general[key].na = true;
            parsed.general[key].observacion = 'N/A — llamada cortada prematuramente, el agente no tuvo oportunidad de completar este criterio';
          } else if (clientWantedToLeave) {
            // Cliente pidió terminar la llamada → forzar N/A en criterios de cierre incluso si Gemini dijo cumple
            parsed.general[key].na = true;
            parsed.general[key].observacion = 'N/A — el cliente solicitó ser contactado después y cortó la llamada; el agente no tuvo oportunidad real de completar esta fase';
          }
        }
      }
    }
  }

  /**
   * Detecta rechazo explícito del cliente y fuerza N/A en criterios de fases
   * que el agente no pudo alcanzar. Usa criteria.naRules.rejection desde la DB.
   */
  _applyRejectionOverride(parsed, criteria) {
    const transcription = (parsed.transcription || '');
    const lines = transcription.split('\n').filter((l) => l.trim());

    const rejectionPatterns = [
      /no me interesa/,
      /no (estoy |me encuentro )?interesad[ao]/,
      /no (lo |la )?quiero/,
      /no (lo |la )?necesito/,
      /no gracias.*no/,
      /no quiero (nada|ningún|ninguna|saber nada)/,
      /no (me |nos )?hace falta/,
      /no (me |nos )?sirve/,
      /no (lo |la )?voy a tomar/,
      /no (me |nos )?interesa (para nada|en absoluto|el servicio|el seguro|la póliza)/,
      /retire.*de.*lista|no (me )?llam(e|en) (más|nunca)/,
    ];

    const clientLines = lines.filter((l) => /^Cliente:/i.test(l));
    const clientRejected = clientLines.some((l) =>
      rejectionPatterns.some((p) => p.test(l.toLowerCase()))
    );

    if (!clientRejected) return;

    const rejectionKeys = new Set(criteria.naRules?.rejection || []);

    logger.info('Rechazo explícito del cliente detectado, forzando N/A en fases post-rechazo');

    if (parsed.general) {
      for (const key of rejectionKeys) {
        if (parsed.general[key] && !parsed.general[key].na && !parsed.general[key].cumple) {
          parsed.general[key].na = true;
          parsed.general[key].observacion =
            'N/A — el cliente rechazó el servicio explícitamente; el agente no tuvo oportunidad de completar esta fase, no es atribuible a su gestión';
        }
      }
    }

    // Proteger ítems de alto impacto que requieren cooperación del cliente.
    // Estos dependen de la campaña — se mantienen hardcodeados usando criteria.key.
    const HIGH_IMPACT_PROTECTED_ON_REJECTION = {
      obama_ventas:   ['validacion_requisitos', 'recapitulacion_venta', 'pregunta_taxes'],
      obama_customer: ['no_gestion_recuperacion', 'recapitulacion'],
      lv_ventas:      ['no_recapitulacion', 'tipificacion_crm'],
      lv_customer:    [],
      claro_tyt:      [],
      claro_hogar:    [],
      claro_wcb:      [],
    };

    const protectedHighImpact = HIGH_IMPACT_PROTECTED_ON_REJECTION[criteria.key] || [];

    if (parsed.high_impact) {
      for (const key of protectedHighImpact) {
        if (parsed.high_impact[key] && !parsed.high_impact[key].cumple) {
          parsed.high_impact[key].cumple = true;
          parsed.high_impact[key].observacion =
            'PROTEGIDO — el cliente rechazó el servicio antes de que el agente pudiera completar este ítem; no es una falta atribuible al agente';
        }
      }
    }
  }

  /**
   * Fuerza N/A en "Manejo de Objeciones" cuando el cliente no presentó
   * ninguna objeción durante la llamada.
   */
  _applyNoObjectionOverride(parsed, criteria) {
    if (!parsed.general?.manejo_objeciones) return;
    if (parsed.general.manejo_objeciones.na) return;
    if (parsed.general.manejo_objeciones.cumple) return;

    const transcription = (parsed.transcription || '').toLowerCase();

    const objectionPatterns = [
      /no me interesa/,
      /no quiero/,
      /ya tengo/,
      /está muy caro|es muy caro|sale muy caro/,
      /no tengo (plata|dinero|presupuesto)/,
      /no puedo pagar/,
      /ya lo tengo|ya tengo uno/,
      /no necesito/,
      /no gracias/,
      /déjeme pensar|déjame pensar/,
      /lo consulto (con|a)/,
      /no estoy interesad[ao]/,
      /no me llame|no me vuelva a llamar/,
      /retire.*de.*base|no llame.*más/,
    ];

    const clientHadObjection = objectionPatterns.some((p) => p.test(transcription));
    if (clientHadObjection) return;

    parsed.general.manejo_objeciones.na = true;
    parsed.general.manejo_objeciones.observacion =
      'N/A — el cliente no presentó ninguna objeción durante la llamada, no hay nada que manejar';
    logger.info('No se detectó objeción del cliente, forzando N/A en manejo_objeciones');
  }

  /**
   * Fuerza N/A en criterios que son inherentemente no verificables por audio.
   * Usa criteria.naRules.always_na desde la DB.
   */
  _applyUnverifiableOverride(parsed, criteria) {
    const alwaysNA = criteria.naRules?.always_na || [];
    const msg = 'N/A — no es posible verificar desde el audio de la grabación';

    for (const key of alwaysNA) {
      if (parsed.general?.[key] && !parsed.general[key].na && !parsed.general[key].cumple) {
        parsed.general[key].na = true;
        parsed.general[key].observacion = msg;
      }
    }
  }

  /**
   * Aplica grupos N/A personalizados definidos por el supervisor en Configuración.
   * Cada grupo custom actúa como un override siempre activo sobre sus keys.
   */
  _applyCustomGroupOverrides(parsed, criteria) {
    const customGroups = criteria.naRules?._custom_groups || [];
    if (customGroups.length === 0) return;

    for (const group of customGroups) {
      const keys = criteria.naRules[group.key] || [];
      for (const key of keys) {
        if (parsed.general?.[key] && !parsed.general[key].na) {
          parsed.general[key].na = true;
          parsed.general[key].observacion = `N/A — ${group.label}`;
        }
      }
    }
  }

  /**
   * Detecta groserías o insultos dichos por el AGENTE en la transcripción
   * y fuerza maltrato_cliente = no cumple con cita exacta.
   */
  _applyProfanityOverride(parsed) {
    if (!parsed.high_impact?.maltrato_cliente) return;

    const transcription = parsed.transcription || '';
    const lines = transcription.split('\n');

    const PROFANITY_PATTERNS = [
      /hijueputa|hp\b|hpta/,
      /gonorrea/,
      /malparido/,
      /pirobo/,
      /\bmarica\b.*(\bidiota\b|\bestúpido\b|\bimbécil\b|pirobo|gonorrea)?/,
      /imbécil|imbecil/,
      /\bidiota\b/,
      /estúpido|estupido/,
      /mamando\s*gallo/,
      /maldita\s*sea/,
      /mecagüen|me\s*cagüen|mecagen/,
      /\bputa\b/,
      /hijue(?:puta|madre)/,
      /\bconcha\b.*\bmadre\b/,
      /\bpendejo\b/,
      /\bcarajo\b.*(?:usted|cliente|señor|señora)/,
      /\bme\s+cago\b/,
      /\bvete\s+a\b/,
      /animal\b.*(?:usted|cliente)/,
    ];

    const agentLines = lines.filter((l) => /^Agente:/i.test(l));

    let foundCita = null;
    for (const line of agentLines) {
      const lower = line.toLowerCase();
      const match = PROFANITY_PATTERNS.find((p) => p.test(lower));
      if (match) {
        foundCita = line.replace(/^Agente:\s*/i, '').trim();
        break;
      }
    }

    if (!foundCita) {
      const fullLower = transcription.toLowerCase();
      const match = PROFANITY_PATTERNS.find((p) => p.test(fullLower));
      if (match) {
        const matchingLine = lines.find((l) => PROFANITY_PATTERNS.some((p) => p.test(l.toLowerCase())));
        if (matchingLine) {
          foundCita = matchingLine.replace(/^(?:Agente|Cliente):\s*/i, '').trim();
        }
      }
    }

    if (!foundCita) return;

    logger.info(`Grosería detectada en transcripción, forzando maltrato_cliente = no cumple. Cita: "${foundCita}"`);

    parsed.high_impact.maltrato_cliente.cumple = false;
    parsed.high_impact.maltrato_cliente.cita = foundCita;
    parsed.high_impact.maltrato_cliente.observacion =
      'FORZADO AUTOMÁTICAMENTE: Se detectó lenguaje soez o insulto del AGENTE. ' +
      'Cualquier grosería o insulto del agente hacia el cliente constituye maltrato y genera score 0.';
  }

  /**
   * Calcula el puntaje final basado en la evaluación.
   */
  _calculateScore(parsed, criteria) {
    const highImpactResults = [];
    let highImpactFailed = false;

    for (const item of criteria.highImpact) {
      const result = parsed.high_impact?.[item.key];
      const cumple = result?.cumple ?? true;
      if (!cumple) highImpactFailed = true;
      highImpactResults.push({
        key: item.key,
        label: item.label,
        cumple,
        observacion: result?.observacion || '',
        cita: result?.cita || '',
        timestamp: result?.timestamp ?? null,
      });
    }

    const generalResults = [];
    let applicableWeight = 0;
    let earnedWeight = 0;

    for (const item of criteria.general) {
      const result = parsed.general?.[item.key];
      const na = result?.na ?? false;
      const cumple = na ? false : (result?.cumple ?? false);

      if (!na) {
        applicableWeight += item.weight;
        if (cumple) earnedWeight += item.weight;
      }

      generalResults.push({
        key: item.key,
        label: item.label,
        weight: item.weight,
        cumple,
        na,
        observacion: result?.observacion || '',
        cita: result?.cita || '',
        timestamp: result?.timestamp ?? null,
      });
    }

    let totalScore = 0;
    if (applicableWeight > 0) {
      totalScore = Math.round((earnedWeight / applicableWeight) * 100);
    }

    const score = highImpactFailed ? 0 : totalScore;

    return { score, generalResults, highImpactResults, highImpactFailed };
  }
}

module.exports = new GeminiService();
