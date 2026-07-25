import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '@config/logger';
import { ApiError } from '@utils/ApiError';
import { env } from '@config/env';

/**
 * Global Error Handler Middleware
 *
 * This MUST be the last middleware registered in app.ts.
 * Express identifies it as an error handler by its 4-parameter signature.
 *
 * Handles three categories of errors:
 * 1. ApiError — our own operational errors (400, 401, 404, etc.)
 * 2. ZodError — validation errors from request schema parsing
 * 3. Unknown errors — unexpected bugs (500)
 *
 * WHY centralize error handling?
 * Without this, every controller would need try/catch with
 * duplicate error-to-response mapping logic.
 */
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void => {
  // Log every error with context
  logger.error('Request error', {
    requestId: res.locals.requestId,
    method: req.method,
    path: req.path,
    error: err.message,
    stack: err.stack,
    statusCode: err instanceof ApiError ? err.statusCode : 500,
  });

  // 1. Known operational errors (ApiError)
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      errors: err.errors.length ? err.errors : undefined,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // 2. Zod validation errors
  if (err instanceof ZodError) {
    const errors = err.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`
    );
    res.status(400).json({
      success: false,
      message: err.issues[0]?.message ?? 'Validation failed',
      errors,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // 3. Prisma unique constraint violation (P2002)
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'P2002'
  ) {
    const prismaErr = err as { meta?: { target?: string[] } };
    const field = prismaErr.meta?.target?.[0] ?? 'field';
    res.status(409).json({
      success: false,
      message: `A record with this ${field} already exists`,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // 4. Unknown / programming error — hide details in production
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    // Only expose error details in development
    ...(env.NODE_ENV === 'development' && {
      debug: {
        message: err.message,
        stack: err.stack,
      },
    }),
    timestamp: new Date().toISOString(),
  });
};
