import { Response } from 'express';

/**
 * Standardized API Response Shape
 *
 * Every endpoint returns the same JSON structure:
 * {
 *   "success": true,
 *   "message": "Customers retrieved",
 *   "data": { ... },
 *   "meta": { "page": 1, "total": 42 }   // optional, for paginated responses
 * }
 *
 * WHY standardize responses?
 * The frontend can write ONE generic error/success handler
 * instead of custom logic per endpoint.
 */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface ApiResponseShape<T> {
  success: boolean;
  message: string;
  data?: T;
  meta?: PaginationMeta;
  errors?: string[];
  timestamp: string;
}

export class ApiResponse {
  /**
   * Send a successful response
   */
  static success<T>(
    res: Response,
    data: T,
    message = 'Success',
    statusCode = 200,
    meta?: PaginationMeta
  ): Response {
    const body: ApiResponseShape<T> = {
      success: true,
      message,
      data,
      timestamp: new Date().toISOString(),
      ...(meta && { meta }),
    };
    return res.status(statusCode).json(body);
  }

  /**
   * Send a created response (201)
   */
  static created<T>(res: Response, data: T, message = 'Created successfully'): Response {
    return ApiResponse.success(res, data, message, 201);
  }

  /**
   * Send a no-content response (204)
   */
  static noContent(res: Response): Response {
    return res.status(204).send();
  }

  /**
   * Send an error response
   */
  static error(
    res: Response,
    message: string,
    statusCode = 500,
    errors: string[] = []
  ): Response {
    const body: ApiResponseShape<null> = {
      success: false,
      message,
      errors: errors.length ? errors : undefined,
      timestamp: new Date().toISOString(),
    };
    return res.status(statusCode).json(body);
  }

  /**
   * Build pagination meta from query params and total count
   */
  static buildPaginationMeta(
    page: number,
    limit: number,
    total: number
  ): PaginationMeta {
    const totalPages = Math.ceil(total / limit);
    return {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    };
  }
}
