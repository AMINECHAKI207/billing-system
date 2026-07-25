/**
 * Custom API Error Class
 *
 * Extends the native Error so we can throw typed HTTP errors
 * from any layer (service, repository) and catch them in the
 * global error handler with the correct HTTP status code.
 *
 * Usage:
 *   throw new ApiError(404, 'Customer not found');
 *   throw new ApiError(400, 'Validation failed', ['name is required']);
 *   throw new ApiError(409, 'Email already in use');
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly errors: string[];
  public readonly isOperational: boolean;

  constructor(
    statusCode: number,
    message: string,
    errors: string[] = [],
    isOperational = true
  ) {
    super(message);

    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.errors = errors;
    this.isOperational = isOperational;

    // Maintains proper stack trace in V8
    Error.captureStackTrace(this, this.constructor);
  }

  // ─── Static factory helpers for common errors ───────────────────────────────

  static badRequest(message: string, errors: string[] = []): ApiError {
    return new ApiError(400, message, errors);
  }

  static unauthorized(message = 'Unauthorized'): ApiError {
    return new ApiError(401, message);
  }

  static forbidden(message = 'Forbidden'): ApiError {
    return new ApiError(403, message);
  }

  static notFound(resource: string): ApiError {
    return new ApiError(404, `${resource} not found`);
  }

  static conflict(message: string): ApiError {
    return new ApiError(409, message);
  }

  static unprocessable(message: string, errors: string[] = []): ApiError {
    return new ApiError(422, message, errors);
  }

  static internal(message = 'Internal server error'): ApiError {
    return new ApiError(500, message, [], false);
  }
}
