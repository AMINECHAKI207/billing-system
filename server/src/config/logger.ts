import winston from 'winston';
import path from 'path';
import { isDev } from './env';

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

/**
 * Custom log format for development (human-readable)
 */
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ timestamp, level, message, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
    return `[${timestamp}] ${level}: ${message}${stack ? `\n${stack}` : ''}${metaStr}`;
  })
);

/**
 * JSON format for production (structured, machine-parseable)
 * Works with log aggregators like Datadog, CloudWatch, etc.
 */
const prodFormat = combine(timestamp(), errors({ stack: true }), json());

/**
 * Application Logger
 *
 * Usage:
 *   import { logger } from '@config/logger';
 *   logger.info('Server started', { port: 5000 });
 *   logger.error('Database error', { error: err.message });
 *   logger.warn('Rate limit hit', { ip: req.ip });
 */
export const logger = winston.createLogger({
  level: isDev ? 'debug' : 'info',
  format: isDev ? devFormat : prodFormat,
  transports: [
    // Always log to console
    new winston.transports.Console(),

    // In production, also write to files
    ...(isDev
      ? []
      : [
          new winston.transports.File({
            filename: path.join('logs', 'error.log'),
            level: 'error',
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5,
          }),
          new winston.transports.File({
            filename: path.join('logs', 'combined.log'),
            maxsize: 10 * 1024 * 1024,
            maxFiles: 10,
          }),
        ]),
  ],
  // Prevent Winston from crashing on uncaught exceptions
  exitOnError: false,
});

// Capture uncaught exceptions and unhandled rejections
logger.exceptions.handle(
  new winston.transports.Console({
    format: isDev ? devFormat : prodFormat,
  })
);

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection', { reason });
});
