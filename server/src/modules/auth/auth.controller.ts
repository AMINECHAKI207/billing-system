import { Request, Response, NextFunction } from 'express';
import { authService } from './auth.service';
import { changePasswordSchema, registerSchema, loginSchema, updateThemeSchema } from './auth.schema';
import { ApiResponse } from '@utils/ApiResponse';
import { env } from '@config/env';

/**
 * Cookie Options for Refresh Token
 *
 * httpOnly: true — JavaScript cannot read this cookie (prevents XSS from stealing it)
 * secure: true — Only sent over HTTPS (disabled in dev so localhost works)
 * sameSite: strict — Prevents CSRF attacks
 */
const getCookieOptions = (rememberMe = true) => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  ...(rememberMe ? { maxAge: 7 * 24 * 60 * 60 * 1000 } : {}),
});

const getAccessCookieOptions = (rememberMe = true) => ({
  ...getCookieOptions(rememberMe),
  maxAge: 15 * 60 * 1000,
});

export class AuthController {
  /**
   * Register endpoint
   */
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      // 1. Validate request body against Zod schema
      const data = registerSchema.parse(req).body;

      // 2. Call business logic
      const user = await authService.register(data);

      // 3. Return success response
      ApiResponse.created(res, { user }, 'Registration successful');
    } catch (error) {
      next(error); // Passes to global errorHandler
    }
  }

  /**
   * Login endpoint
   */
  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const data = loginSchema.parse(req).body;

      const { user, tokens } = await authService.login(data);

      // Keep both JWTs out of JavaScript-accessible storage.
      res.cookie('accessToken', tokens.accessToken, getAccessCookieOptions(data.rememberMe));
      res.cookie('refreshToken', tokens.refreshToken, getCookieOptions(data.rememberMe));

      // Keep the token in the response for backwards-compatible API clients.
      // The web client authenticates exclusively through the HttpOnly cookies.
      ApiResponse.success(
        res,
        { user, accessToken: tokens.accessToken },
        'Login successful'
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Refresh Token endpoint
   * 
   * Reads the refresh token from the httpOnly cookie and returns
   * a fresh access token.
   */
  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const refreshToken = req.cookies.refreshToken;

      if (!refreshToken) {
        // Return 401 directly without wrapping in ApiError if you prefer,
        // but ApiResponse handles it cleanly.
        ApiResponse.error(res, 'No refresh token provided', 401);
        return;
      }

      const tokens = await authService.refreshToken(refreshToken);

      // Rotate the refresh token (security best practice)
      res.cookie('accessToken', tokens.accessToken, getAccessCookieOptions(true));
      res.cookie('refreshToken', tokens.refreshToken, getCookieOptions(true));

      ApiResponse.success(
        res,
        { accessToken: tokens.accessToken },
        'Token refreshed'
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Logout endpoint
   * 
   * Clears the httpOnly cookie.
   */
  async logout(_req: Request, res: Response, next: NextFunction) {
    try {
      res.clearCookie('accessToken', getAccessCookieOptions());
      res.clearCookie('refreshToken', getCookieOptions());
      ApiResponse.success(res, null, 'Logged out successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Current User (Me) endpoint
   * 
   * Depends on the `authenticate` middleware to populate `req.user`.
   */
  async me(req: Request, res: Response, next: NextFunction) {
    try {
      ApiResponse.success(res, { user: req.user }, 'Current user');
    } catch (error) {
      next(error);
    }
  }

  async changePassword(req: Request, res: Response, next: NextFunction) {
    try {
      const data = changePasswordSchema.parse(req).body;
      await authService.changePassword(req.user!.id, data);
      ApiResponse.success(res, null, 'Password changed successfully');
    } catch (error) {
      next(error);
    }
  }

  async updateTheme(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateThemeSchema.parse(req).body;
      const user = await authService.updateTheme(req.user!.id, data);
      ApiResponse.success(res, { user }, 'Theme preference updated');
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();
