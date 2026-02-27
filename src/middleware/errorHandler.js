const logger = require('../utils/logger');

function errorHandler(err, req, res, _next) {
  logger.error(`${req.method} ${req.originalUrl} - ${err.message}`, err);

  // Detectar rate limit de Gemini (429) y devolver mensaje claro al cliente
  const isGeminiRateLimit =
    err.statusCode === 429 ||
    err.status === 429 ||
    err.message?.includes('429') ||
    err.message?.includes('Resource exhausted');

  if (isGeminiRateLimit) {
    return res.status(429).json({
      error: true,
      message: 'El análisis con IA no está disponible en este momento (límite de Gemini alcanzado). Espere 1-2 minutos e inténtelo de nuevo.',
    });
  }

  const status = err.statusCode || 500;
  const message =
    status === 500 ? 'Error interno del servidor' : err.message;

  res.status(status).json({
    error: true,
    message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
}

module.exports = errorHandler;
