const logger = require('../utils/logger');

function errorHandler(err, req, res, _next) {
  logger.error(`${req.method} ${req.originalUrl} - ${err.message}`, err);

  // Spending cap mensual: no se recupera reintentando, el proyecto está bloqueado
  const isSpendingCap = err.isSpendingCap || err.message?.includes('spending cap') || err.message?.includes('monthly spending');
  if (isSpendingCap) {
    return res.status(503).json({
      error: true,
      message: 'El análisis automático con IA no está disponible (límite de gasto mensual de Gemini alcanzado). Puedes completar la evaluación manualmente en el formulario a continuación.',
    });
  }

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
