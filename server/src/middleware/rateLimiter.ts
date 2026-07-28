import rateLimit from 'express-rate-limit';
import { ApiError } from '@utils/ApiError';
import { isDev, isTest } from '@config/env';

/**
 * Rate Limiters
 *
 * WHY: Prevents brute-force attacks on login and abuse of the API.
 * Auth endpoints get stricter limits than general API endpoints.
 */

/**
 * General API rate limiter — applied globally
 * 100 requests per 15 minutes per IP
 */
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDev ? 5000 : 100,
  skip: () => isTest,
  standardHeaders: true,   // Return rate limit info in headers
  legacyHeaders: false,     // Disable the X-RateLimit-* headers (deprecated)
  handler: (_req, _res, next) => {
    next(
      new ApiError(
        429,
        'Too many requests. Please try again in 15 minutes.'
      )
    );
  },
});

/**
 * Auth route limiter — stricter
 * 10 requests per 15 minutes per IP
 * Prevents brute-force login attempts
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 200 : 10,
  skip: () => isTest,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins
  handler: (_req, _res, next) => {
    next(
      new ApiError(
        429,
        'Too many login attempts. Please try again in 15 minutes.'
      )
    );
  },
});
