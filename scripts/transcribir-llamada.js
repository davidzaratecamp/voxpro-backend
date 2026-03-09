/**
 * Script personal: transcribir audio-llamada.mp3
 * Uso: node scripts/transcribir-llamada.js
 * Resultado: docs/transcripcion-llamada.txt
 */

require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require('@google/generative-ai/server');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.GEMINI_API_KEY;
const AUDIO_PATH = path.join(__dirname, '../../frontend/public/audio-llamada.mp3');
const OUTPUT_PATH = path.join(__dirname, '../../docs/transcripcion-llamada.txt');

async function transcribir() {
  console.log('Iniciando transcripción...');
  console.log(`Audio: ${AUDIO_PATH}`);

  const fileManager = new GoogleAIFileManager(API_KEY);
  const genAI = new GoogleGenerativeAI(API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  // Subir el archivo MP3
  console.log('Subiendo audio a Gemini File API...');
  const uploadResponse = await fileManager.uploadFile(AUDIO_PATH, {
    mimeType: 'audio/mp3',
    displayName: 'audio-llamada-personal',
  });

  const fileUri = uploadResponse.file.uri;
  const uploadedName = uploadResponse.file.name;
  console.log(`Audio subido: ${uploadedName}`);

  const prompt = `Transcribe la conversación completa de esta llamada telefónica de forma literal y detallada.

Identifica los hablantes como "Agente:" y "Cliente:".

Estas son llamadas de un call center OUTBOUND (el agente llama al cliente). Para identificar correctamente quién es quién:
- El AGENTE es quien INICIA la llamada y llama al cliente por su nombre.
- El AGENTE se presenta, menciona la empresa, sigue un guion, explica productos o procesos.
- El CLIENTE es quien RECIBE la llamada, responde con "Aló", "Sí", "Diga".
- Si una persona dice "Señor [nombre], ¿cómo está?" esa persona es el AGENTE, no el cliente.

Incluye TODO lo dicho, sin omitir ni resumir. Transcribe de forma literal, incluyendo muletillas, silencios marcados, interrupciones y todo el contenido de la conversación.

Formato de salida:
Agente: [lo que dice el agente]
Cliente: [lo que dice el cliente]
Agente: [continúa...]
...

Solo devuelve la transcripción, sin comentarios adicionales.`;

  console.log('Solicitando transcripción a Gemini...');
  const result = await model.generateContent([
    { fileData: { mimeType: 'audio/mp3', fileUri } },
    { text: prompt },
  ]);

  const transcripcion = result.response.text();

  // Limpiar archivo subido
  await fileManager.deleteFile(uploadedName).catch(() => {});
  console.log('Archivo temporal eliminado de Gemini.');

  // Guardar resultado
  const fecha = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
  const contenido = `TRANSCRIPCIÓN DE LLAMADA
Fecha de transcripción: ${fecha}
Archivo: audio-llamada.mp3
${'='.repeat(60)}

${transcripcion}
`;

  // Asegurarse de que el directorio docs exista
  const docsDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_PATH, contenido, 'utf-8');
  console.log(`\nTranscripción guardada en: ${OUTPUT_PATH}`);
}

transcribir().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
