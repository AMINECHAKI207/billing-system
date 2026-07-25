import { Request, Response, NextFunction } from 'express';
import { logger } from '@config/logger';

/**
 * HTTP Request Logger Middleware
 *
 * Logs every incoming request with method, path, status code,
 * and duration. In production, this data feeds into monitoring dashboards.
 *
 * WHY custom instead of morgan?
 * We use Winston as our logger — keeping a single logging library
 * avoids output going to different places.
 */
export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const start = Date.now();
  const { method, originalUrl, ip } = req;

  // Log when response is finished
  res.on('finish', () => {
    const duration = Date.now() - start;
    const { statusCode } = res;

    const logData = {
      requestId: res.locals.requestId,
      method,
      path: originalUrl,
      statusCode,
      duration: `${duration}ms`,
      ip,
      userAgent: req.headers['user-agent'],
    };

    // Color-code by status for readability
    if (originalUrl === '/ready' && statusCode === 503) {
      logger.warn('HTTP Request', logData);
    } else if (statusCode >= 500) {
      logger.error('HTTP Request', logData);
    } else if (statusCode >= 400) {
      logger.warn('HTTP Request', logData);
    } else {
      logger.info('HTTP Request', logData);
    }
  });

  next();
};
