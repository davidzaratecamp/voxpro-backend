
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');




const app = express();

// Confiar en el proxy de nginx (necesario para express-rate-limit con X-Forwarded-For)
app.set('trust proxy', 1);

// CORS restringido
app.use(cors({
  origin: config.cors.origin,
  credentials: true,
}));

// Rate limiting global: 100 req/min
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: true, message: 'Demasiadas solicitudes, intente de nuevo en un momento' },
});
app.use(globalLimiter);

// Rate limiting para login: 5 intentos / 15 min
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: true, message: 'Demasiados intentos de login, intente de nuevo en 15 minutos' },
});
app.use('/api/auth/login', loginLimiter);

app.use(express.json());

// Rutas API
app.use('/api', routes);

// 404 para rutas no encontradas
app.use((req, res) => {
  res.status(404).json({ error: true, message: 'Ruta no encontrada' });
});

// Manejo centralizado de errores
app.use(errorHandler);

module.exports = app;
