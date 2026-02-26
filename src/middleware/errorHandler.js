const logger = require('../utils/logger');

function errorHandler(err, req, res, _next) {
  logger.error(`${req.method} ${req.originalUrl} - ${err.message}`, err);

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
