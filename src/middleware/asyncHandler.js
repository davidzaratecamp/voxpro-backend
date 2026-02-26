/**
 * Wrapper para controllers async que captura errores
 * y los pasa al middleware de error de Express.
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
