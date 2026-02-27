const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require('@google/generative-ai/server');
const os = require('os');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const { getCriteria } = require('../config/evaluationCriteria');

class GeminiService {
  constructor() {
    this.genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    this.model = this.genAI.getGenerativeModel({ model: config.gemini.model });
    this.fileManager = new GoogleAIFileManager(config.gemini.apiKey);
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
    const criteria = getCriteria(clientCode, agentId, proyectoId);
    if (!criteria) {
      throw new Error(`No hay criterios de evaluación para el cliente: ${clientCode}`);
    }

    const prompt = this._buildPrompt(criteria);
    const sizeKB = (audioBuffer.length / 1024).toFixed(0);
    logger.info(`Subiendo audio a Gemini File API (${sizeKB} KB) para ${criteria.label}`);

    // Subir el audio como archivo (evita las restricciones de inlineData en producción)
    const tmpPath = path.join(os.tmpdir(), `vxpro_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.wav`);
    let uploadedFileName = null;
    try {
      fs.writeFileSync(tmpPath, audioBuffer);
      const uploadResponse = await this.fileManager.uploadFile(tmpPath, {
        mimeType: 'audio/wav',
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
      .map((item) => `  - "${item.key}" (${item.label}): peso ${item.weight}%`)
      .join('\n');

    const highImpactList = criteria.highImpact
      .map((item) => `  - "${item.key}" (${item.label})`)
      .join('\n');

    return `Eres un auditor de calidad experto en call centers de ventas y telecomunicaciones en Colombia. Evalúas con criterio justo y contextual, entendiendo la realidad de las llamadas de ventas.

Analiza el audio de esta llamada telefónica y realiza dos tareas:

## TAREA 1: TRANSCRIPCIÓN
Transcribe la conversación completa de forma literal. Identifica los hablantes como "Agente:" y "Cliente:". Incluye todo lo dicho, sin omitir ni resumir.

IDENTIFICACIÓN DE HABLANTES (MUY IMPORTANTE):
Estas son llamadas de un call center OUTBOUND (el agente llama al cliente). Para identificar correctamente quién es quién:
- El AGENTE es quien INICIA la llamada y llama al cliente por su nombre (ej: "Señor Pérez", "Señor Olier").
- El AGENTE se presenta, menciona la empresa, sigue un guion, explica productos o procesos.
- El CLIENTE es quien RECIBE la llamada, responde con "Aló", "Sí", "Diga".
- Si una persona dice "Señor [nombre], ¿cómo está?" esa persona es el AGENTE, no el cliente.
- NO confundas los roles. Verifica que la asignación de "Agente:" y "Cliente:" sea coherente durante toda la transcripción.

## TAREA 2: EVALUACIÓN DE CALIDAD
Evalúa la llamada según los criterios del formulario de "${criteria.label}".

### Criterios Generales:
${generalList}

### Ítems de Alto Impacto (cumplimiento obligatorio):
${highImpactList}

## REGLAS DE EVALUACIÓN

### REGLA FUNDAMENTAL — Evalúa la GESTIÓN, NO el RESULTADO:
Tu trabajo es evaluar CÓMO el agente manejó la llamada, NO si la venta se cerró o si el problema se resolvió. Un agente puede hacer todo correctamente y aun así no lograr la venta porque:
- El producto/servicio no tiene cobertura en el área del cliente.
- El cliente ya tiene seguro privado y no quiere renovar.
- La base de datos del CRM está desactualizada (no es culpa del agente).
- El cliente ya reportó un problema a otros agentes y el sistema no lo refleja.
- El cliente simplemente no quiere el producto.

En TODOS estos casos, si el agente fue profesional, verificó la información, intentó gestionar, y cerró correctamente, su puntaje debe reflejar ESA gestión, no el resultado comercial. Un agente que no vende pero gestiona bien puede obtener 80-100 puntos.

NUNCA penalices al agente por circunstancias fuera de su control.

### Regla de Alto Impacto:
Si CUALQUIER ítem de Alto Impacto NO se cumple, el puntaje total es AUTOMÁTICAMENTE 0.
Los ítems de alto impacto son "cumple" si el agente NO comete la falta (ej: "Maltrato al Cliente" cumple si NO hubo maltrato).

UMBRAL DE ALTO IMPACTO (CRÍTICO — leer antes de evaluar):
Los ítems de alto impacto solo deben marcarse como "no cumple" cuando hay una FALTA GRAVE y EVIDENTE cometida POR EL AGENTE. No son para evaluar calidad, calidez o resultados — eso es responsabilidad de los criterios generales. Ejemplos específicos:
- "Falta de empatía con el cliente": Solo NO cumple si el agente fue GROSERO, HOSTIL, DESPECTIVO o mostró total INDIFERENCIA activa (ej: ignorar al cliente, tratarlo mal, ser sarcástico, burlarse). NO aplica si simplemente faltó calidez, rapport o técnicas de empatía — eso se penaliza en criterios generales. Un agente que es educado y mantiene la calma ante un cliente frustrado CUMPLE este ítem, aunque le falte más empatía activa.
- "Maltrato al cliente": Solo si hay insultos, gritos, humillación o agresión verbal directa.
- "Falta de gestión comercial": Solo si el agente NO hizo ABSOLUTAMENTE NINGÚN intento de gestión. Si el agente intentó gestionar pero no logró la venta (por circunstancias fuera de su control), CUMPLE.
- "Recapitulación": Si no hubo venta o el contexto no lo permite (ej: cliente rechaza el servicio), marca cumple. Solo NO cumple si hubo una venta/acuerdo y el agente no recapituló.
- Items como "No referido", "No marcaciones", etc.: Evalúa si el agente hizo el esfuerzo correspondiente, no si el resultado fue positivo.
En resumen: el alto impacto es EXCLUSIVAMENTE para faltas GRAVES del AGENTE que ameritan un cero automático, NUNCA por resultados desfavorables.

### Regla de Contexto (MUY IMPORTANTE):
Cada criterio general puede tener 3 resultados: "cumple", "no_cumple", o "na" (No Aplica).

Marca un criterio como "na" cuando:
- El criterio es IMPOSIBLE de cumplir por la naturaleza de la llamada (ej: "Recordatorio de plan" cuando el cliente es un prospecto nuevo que nunca ha tenido plan).
- La llamada está truncada o incompleta y el criterio no se puede evaluar (ej: "Cierre Efectivo" si la grabación se corta antes de que termine la llamada).
- El criterio no tiene sentido en el contexto específico de la conversación.
- El criterio depende de un prerequisito que no se cumple por circunstancias ajenas al agente (ej: "Cotización y validación de ingresos" cuando no hay cobertura en el estado del cliente — no puedes cotizar algo que no existe; ej: "Requisitos" cuando el cliente rechaza el servicio desde el inicio).

### Regla de Llamada Cortada por el Cliente (CRÍTICO):
Si el CLIENTE termina/cuelga la llamada prematuramente (por estar en el trabajo, ocupado, no poder hablar, etc.), TODOS los criterios que dependían de continuar la llamada deben marcarse como "na". Esto incluye:
- Cierre de la llamada, cierre de fase, cierre de venta → N/A (el agente no tuvo oportunidad de cerrar)
- Explicación del servicio → N/A si no alcanzó a llegar a esa fase
- Recapitulación → N/A si no hubo acuerdo que recapitular
- Referidos, postventa, documentación → N/A si la llamada no llegó a esa etapa
El agente debe ser evaluado SOLO por lo que alcanzó a hacer ANTES del corte. Si lo que hizo fue correcto (saludo, contexto, preguntas de validación), esos criterios deben ser "cumple". Un agente que gestiona bien durante 2 minutos antes de que el cliente cuelgue puede obtener 90-100 puntos sobre los criterios que SÍ aplican.

### Regla de Tercero / Cliente No Disponible (CRÍTICO):
Si la persona que contesta NO es el cliente titular (ej: contesta un familiar, hijo, esposo, compañero), el agente NO debe discutir información de salud, planes o coberturas con esa persona (privacidad/HIPAA). En este caso:
- TODOS los criterios que requieren hablar con el cliente titular → N/A (recordatorio de plan, coberturas, dental/visión, requisitos, cotización, explicación del servicio, cierre de venta, etc.)
- Evalúa SOLO: saludo, identificación del interlocutor, obtención de horario para callback, profesionalismo y despedida.
- Si el agente identificó que no era el titular, preguntó cuándo contactarlo, y cerró con cortesía → su puntaje debe ser alto (90-100%) sobre los criterios aplicables.
- El agente NO debe ser penalizado por no hacer gestión comercial con alguien que no es el titular.

NO marques "na" si el agente pudo cumplir el criterio pero no lo hizo. Solo usa "na" cuando es genuinamente imposible o inaplicable.

### Regla de Ventas y Gestión Comercial:
- Evalúa lo que el agente SÍ hizo con la oportunidad, no lo que era imposible hacer.
- Si un agente contacta a la persona equivocada pero logra convertir al interlocutor en un prospecto real, eso es una gestión exitosa.
- Si el agente aprovecha una marcación errónea para generar una venta potencial, criterios como "Resolución en primer contacto" deben considerar ese pivote como positivo.
- Si el cliente rechaza el producto por razones válidas (no hay cobertura, ya tiene seguro, no le interesa), evalúa si el agente: (1) escuchó al cliente, (2) intentó retenerlo, (3) pidió referidos, (4) cerró con cortesía. Todo eso es BUENA gestión aunque no haya venta.
- NUNCA penalices al agente porque la venta no se cerró. Penaliza SOLO si el agente no intentó gestionar.

### Regla de Callback / Agendamiento (MUY IMPORTANTE):
Si el agente agenda una llamada de seguimiento (callback) con fecha y hora específica, eso ES un cierre exitoso de la llamada. Ejemplos:
- "Te llamo mañana a las 8" → Cierre de fase = CUMPLE, Cierre de venta = CUMPLE o N/A según contexto.
- "Cuando esté tu esposo presente, nos llamas" → Cierre = CUMPLE.
Un callback demuestra que el agente mantuvo el interés del prospecto y aseguró una segunda oportunidad. Es una técnica de ventas válida y profesional.

### Regla de Validación Parcial:
Si el agente intentó validar requisitos o recopilar información pero no pudo completar porque el cliente no tiene los datos (ej: "no sé cuánto pago, lo maneja mi esposo"), evalúa lo que el agente SÍ logró recopilar. Si hizo las preguntas correctas y obtuvo información útil (tipo de seguro, cobertura, situación), marca "cumple". Solo marca "no cumple" si el agente NO intentó validar en absoluto.

### Regla de Manejo de Objeciones:
El criterio "Manejo de Objeciones" SOLO aplica cuando el cliente presenta una objeción CLARA: rechazo explícito, duda adversarial, queja, resistencia a la compra o al servicio.
Si el cliente responde de forma positiva o neutral (ej: "bien", "sí señora", "ah bueno", escucha sin protestar, o la llamada termina antes de que haya oportunidad de objeciones), este criterio es "na".
NUNCA marques "no cumple" en Manejo de Objeciones si el cliente no hizo ninguna objeción: no hay nada que manejar. Marcar "no cumple" en ese caso sería evaluar algo que nunca ocurrió.

### Regla de Uso de Herramientas:
El criterio "Uso de Herramientas" evalúa si el agente utiliza correctamente sus herramientas internas (CRM, sistemas de gestión, bases de datos). Como el uso de herramientas ocurre en el computador del agente y NO es audible en la grabación, este criterio debe marcarse como "na" salvo que el audio proporcione evidencia explícita (ej: el agente lee en voz alta datos del sistema, consulta información en pantalla de forma audible, o comete un error de información verificable por herramienta).
Si no hay evidencia audible del uso de herramientas, marca "na". NUNCA marques "no cumple" por ausencia de evidencia: la ausencia de evidencia no es evidencia de incumplimiento.

### Regla de Despedida en Llamada Cortada:
Si la llamada fue cortada prematuramente — ya sea porque el cliente dijo que estaba ocupado, o porque la grabación termina abruptamente sin despedida — el criterio "Despedida" debe marcarse como "na". El agente NO puede despedirse de alguien que ya colgó o de una llamada que se cortó antes de que llegara a ese momento.

### Regla de Grabación Ininteligible (CRÍTICO):
Si el audio es de muy mala calidad y la conversación es ininteligible o incoherente por razones ajenas al agente (ruido excesivo, señal rota, grabación defectuosa, eco extremo, fallo técnico), marca \`"call_unintelligible": true\`. En este caso:
- La grabación NO puede evaluarse objetivamente: no es culpa del agente.
- El sistema asignará automáticamente un puntaje de 100.
- Describe brevemente en "resumen" por qué la grabación es ininteligible.

Señales claras de grabación ininteligible:
- La transcripción contiene frases sin ningún sentido lógico (ej: "ella ella ella ella es mi video", "voy a servir un poquito de radiación").
- El agente o la línea dice explícitamente "no se oye", "se está cerrando", indicando un fallo técnico de la llamada.
- La llamada dura menos de 30 segundos y el audio es puro ruido o palabras sueltas sin conversación real.
- No hay ninguna conversación coherente posible entre agente y cliente.

IMPORTANTE: Solo usa \`call_unintelligible: true\` cuando la incoherencia se debe a FALLO TÉCNICO de la grabación, NO cuando el agente simplemente gestionó mal o la llamada fue corta pero comprensible. Si puedes evaluar la gestión del agente aunque sea parcialmente, evalúa normalmente.

### Cálculo del puntaje:
El puntaje se calcula SOLO con los criterios que aplican (excluyendo los "na"). Los pesos se redistribuyen proporcionalmente entre los criterios aplicables.

## FORMATO DE RESPUESTA
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

    // Post-procesamiento: forzar N/A en manejo_objeciones si no hubo objeción
    this._applyNoObjectionOverride(parsed, criteria);

    // Post-procesamiento: forzar N/A en criterios no verificables por audio
    this._applyUnverifiableOverride(parsed);

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
   */
  _applyThirdPartyOverride(parsed, criteria) {
    const transcription = (parsed.transcription || '').toLowerCase();

    // Patrones que indican que quien contestó NO es el titular
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

    logger.info('Tercero detectado en transcripción, forzando N/A en criterios del titular');

    // Criterios generales que requieren hablar con el titular, por campaña
    const TITULAR_CRITERIA = {
      obama_customer: [
        'recordatorio_plan',
        'complementar_dental_vision',
      ],
      obama_ventas: [
        'contexto_personalizacion',
        'cierre_experiencia',
        'requisitos',
        'cotizacion_ingresos',
        'explicacion_cierre',
      ],
      claro_tyt: [
        'perfilamiento_enfocado',
        'oferta_comercial',
        'manejo_objeciones',
        'cierre_comercial',
        'convenios_bancarios',
      ],
      claro_hogar: [
        'interes_necesidades',
        'habilidades_comerciales',
        'resalta_beneficios',
        'cierre_comercial',
        'manejo_objeciones',
      ],
      claro_wcb: [
        'interes_necesidades',
        'oferta_comercial',
        'manejo_objeciones',
        'cierre_comercial',
        'resalta_beneficios',
      ],
      lv_customer: [
        'cobros_prevencion_mora',
        'cierre_llamada',
        'notificaciones_seguimiento',
      ],
      lv_ventas: [
        'gestion_comercial',
        'reformulacion',
        'cierre_llamada',
      ],
    };

    // Identificar la campaña por el label de los criterios
    const campaignKey = Object.keys(TITULAR_CRITERIA).find(
      (key) => {
        const labels = {
          obama_customer: 'obama customer', obama_ventas: 'obama ventas',
          claro_tyt: 'claro tyt', claro_hogar: 'claro hogar', claro_wcb: 'claro wcb',
          lv_customer: 'lv customer', lv_ventas: 'lv ventas',
        };
        return criteria.label.toLowerCase() === labels[key];
      }
    );

    if (!campaignKey) return;

    const keysToForceNA = new Set(TITULAR_CRITERIA[campaignKey]);

    // Forzar N/A en los criterios generales que dependen del titular
    if (parsed.general) {
      for (const key of keysToForceNA) {
        if (parsed.general[key] && !parsed.general[key].na) {
          parsed.general[key].na = true;
          parsed.general[key].observacion = 'N/A — llamada atendida por tercero, no el titular';
        }
      }
    }
  }

  /**
   * Detecta si la llamada fue cortada prematuramente (el cliente colgó,
   * dijo que estaba ocupado, o la grabación termina abruptamente sin despedida)
   * y fuerza N/A en criterios de cierre/fases finales que el agente no tuvo
   * oportunidad de completar.
   */
  _applyDroppedCallOverride(parsed, criteria) {
    const transcription = (parsed.transcription || '');
    const lower = transcription.toLowerCase();
    const lines = transcription.split('\n').filter((l) => l.trim());

    // --- Detección 1: cliente dice explícitamente que está ocupado/no puede ---
    const droppedPatterns = [
      /estoy (demasiado )?ocupad[ao]/,
      /no (puedo|tengo tiempo) (ahorita|ahora|en este momento)/,
      /me puede[s]? (llamar|marcar) (después|luego|más tarde|en una hora|en un rato|mañana)/,
      /llám[ae]me (después|luego|más tarde|mañana)/,
      /estoy (en el )?trabaj(o|ando)/,
      /estoy manejando/,
      /no es buen momento/,
      /no puedo hablar (ahorita|ahora|en este momento)/,
      /estoy en (una )?reuni[oó]n/,
      /llame.*más tarde|llámeme.*más tarde/,
    ];
    const clientWantedToLeave = droppedPatterns.some((p) => p.test(lower));

    // --- Detección 2: corte abrupto — no hay despedida y el agente habla al final ---
    const farewell = /gracias|hasta luego|chao|adiós|bye|que (le |te )?vaya bien|fue un placer|con mucho gusto/;
    const lastFiveLines = lines.slice(-5).join(' ').toLowerCase();
    const hadAnyFarewell = farewell.test(lastFiveLines);
    const lastLine = lines[lines.length - 1] || '';
    const callEndedAbruptly = !hadAnyFarewell && /^Agente:/i.test(lastLine) && lines.length >= 3;

    if (!clientWantedToLeave && !callEndedAbruptly) return;

    // Verificar despedida normal en la última línea del cliente
    const lastClientLine = [...lines].reverse().find((l) => /^Cliente:/i.test(l));
    const hadNormalGoodbye = farewell.test(lastClientLine?.toLowerCase() || '');
    if (hadNormalGoodbye) return;

    logger.info(
      `Llamada cortada detectada (${callEndedAbruptly ? 'corte abrupto' : 'cliente ocupado'}), ` +
      'forzando N/A en criterios de cierre/fases finales'
    );

    // Criterios de cierre/fases finales que requieren que la llamada llegue al final.
    // Incluye despedida en todas las campañas que la tienen.
    const CLOSURE_CRITERIA = {
      obama_customer: [
        'cierre_efectivo',
        'complementar_dental_vision',
        'recordatorio_plan',
      ],
      obama_ventas: [
        'cierre_experiencia',
        'requisitos',
        'cotizacion_ingresos',
        'explicacion_cierre',
      ],
      claro_tyt: [
        'cierre_comercial',
        'convenios_bancarios',
        'manejo_objeciones',
        'despedida',
      ],
      claro_hogar: [
        'cierre_comercial',
        'habilidades_comerciales',
        'manejo_objeciones',
        'despedida',
        'tipificacion',
      ],
      claro_wcb: [
        'cierre_comercial',
        'manejo_objeciones',
        'despedida',
        'tipificacion',
      ],
      lv_customer: [
        'cierre_llamada',
        'cobros_prevencion_mora',
        'notificaciones_seguimiento',
      ],
      lv_ventas: [
        'gestion_comercial',
        'reformulacion',
        'cierre_llamada',
      ],
    };

    const CAMPAIGN_LABELS = {
      obama_customer: 'obama customer', obama_ventas: 'obama ventas',
      claro_tyt: 'claro tyt', claro_hogar: 'claro hogar', claro_wcb: 'claro wcb',
      lv_customer: 'lv customer', lv_ventas: 'lv ventas',
    };

    const campaignKey = Object.keys(CLOSURE_CRITERIA).find(
      (key) => criteria.label.toLowerCase() === CAMPAIGN_LABELS[key]
    );

    if (!campaignKey) return;

    const keysToForceNA = new Set(CLOSURE_CRITERIA[campaignKey]);

    if (parsed.general) {
      for (const key of keysToForceNA) {
        if (parsed.general[key] && !parsed.general[key].na && !parsed.general[key].cumple) {
          // Solo forzar N/A si Gemini lo marcó como "no cumple"
          // Si ya cumple, el agente lo logró antes del corte
          parsed.general[key].na = true;
          parsed.general[key].observacion = 'N/A — llamada cortada prematuramente, el agente no tuvo oportunidad';
        }
      }
    }
  }

  /**
   * Fuerza N/A en "Manejo de Objeciones" cuando el cliente no presentó
   * ninguna objeción durante la llamada. Aplica a todas las campañas
   * que tengan el criterio manejo_objeciones.
   */
  _applyNoObjectionOverride(parsed, criteria) {
    if (!parsed.general?.manejo_objeciones) return;
    if (parsed.general.manejo_objeciones.na) return;
    if (parsed.general.manejo_objeciones.cumple) return; // ya cumple, no tocar

    const transcription = (parsed.transcription || '').toLowerCase();

    // Patrones que indican una objeción real del cliente
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
    if (clientHadObjection) return; // hubo objeción real, Gemini debe evaluarla

    parsed.general.manejo_objeciones.na = true;
    parsed.general.manejo_objeciones.observacion =
      'N/A — el cliente no presentó ninguna objeción durante la llamada, no hay nada que manejar';
    logger.info('No se detectó objeción del cliente, forzando N/A en manejo_objeciones');
  }

  /**
   * Fuerza N/A en criterios que son inherentemente no verificables por audio:
   * - uso_herramientas: el agente usa su CRM/sistema en silencio, no se oye
   * - tipificacion: registro post-llamada, no audible
   */
  _applyUnverifiableOverride(parsed) {
    const UNVERIFIABLE = ['uso_herramientas', 'tipificacion'];
    const msg = 'N/A — no es posible verificar desde el audio de la grabación';

    for (const key of UNVERIFIABLE) {
      if (parsed.general?.[key] && !parsed.general[key].na && !parsed.general[key].cumple) {
        parsed.general[key].na = true;
        parsed.general[key].observacion = msg;
      }
    }
  }

  /**
   * Calcula el puntaje final basado en la evaluación.
   */
  _calculateScore(parsed, criteria) {
    // Evaluar alto impacto primero
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

    // Evaluar criterios generales
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

    // Score proporcional: redistribuir pesos excluyendo N/A
    let totalScore = 0;
    if (applicableWeight > 0) {
      totalScore = Math.round((earnedWeight / applicableWeight) * 100);
    }

    // Si falla alto impacto → score = 0
    const score = highImpactFailed ? 0 : totalScore;

    return { score, generalResults, highImpactResults, highImpactFailed };
  }
}

module.exports = new GeminiService();
