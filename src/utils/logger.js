const winston = require('winston');
const path = require('path');
const DailyRotateFile = require('winston-daily-rotate-file');
const config = require('../config');
const fs = require('fs');

// Crear directorio de logs si no existe
const logDir = path.resolve(config.log.dir);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logger = winston.createLogger({
  level: config.log.level,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      const stackStr = stack ? `\n${stack}` : '';
      return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}${stackStr}`;
    })
  ),
  transports: [
    new DailyRotateFile({
      dirname: logDir,
      filename: 'voxpro-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '50m',
      maxFiles: '30d',
    }),
    new DailyRotateFile({
      dirname: logDir,
      filename: 'error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '50m',
      maxFiles: '90d',
    }),
  ],
});

// En desarrollo, mostrar también en consola
if (config.env !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, stack }) => {
          const stackStr = stack ? `\n${stack}` : '';
          return `[${timestamp}] ${level}: ${message}${stackStr}`;
        })
      ),
    })
  );
}

module.exports = logger;
