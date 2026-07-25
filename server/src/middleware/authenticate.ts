import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { env } from '@config/env';
import { ApiError } from '@utils/ApiError';
import { prisma } from '@config/database';

/**
 * JWT Authentication Middleware
 *
 * Verifies the HttpOnly accessToken cookie.
 * On success: attaches the decoded user payload to req.user
 * On failure: throws 401 ApiError caught by global error handler
 *
 * A Bearer header is accepted as a backwards-compatible fallback for
 * automated integrations and existing server tests.
 */
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = req.cookies?.accessToken ?? (
      authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined
    );

    if (!token) {
      throw ApiError.unauthorized('No authentication cookie provided');
    }

    // Verify the token — throws if expired or invalid
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as {
      userId: string;
      email: string;
      role: string;
    };

    // Fetch fresh user from DB to ensure account is still active
    // WHY: Token could be valid but user deactivated since issuance
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        themePreference: true,
        isActive: true,
        rbacRole: {
          select: {
            id: true,
            name: true,
            permissions: {
              select: { permission: { select: { key: true } } },
            },
          },
        },
      },
    });

    if (!user) {
      throw ApiError.unauthorized('User no longer exists');
    }

    if (!user.isActive) {
      throw ApiError.unauthorized('Account has been deactivated');
    }

    const role = normalizeRole(user.role);
    if (!role) {
      throw ApiError.unauthorized('Invalid user role');
    }

    // Attach fresh DB user to request for downstream authorization.
    req.user = {
      ...user,
      role,
      rbacRoleId: user.rbacRole?.id ?? null,
      permissions: user.rbacRole?.permissions.map(({ permission }) => permission.key) ?? [],
    };
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      next(ApiError.unauthorized('Token expired'));
    } else if (error instanceof jwt.JsonWebTokenError) {
      next(ApiError.unauthorized('Invalid token'));
    } else {
      next(error);
    }
  }
};

function normalizeRole(role: string | Role | null | undefined): Role | undefined {
  const normalized = String(role ?? '').trim().toUpperCase();

  if (normalized === Role.ADMIN) return Role.ADMIN;
  if (normalized === Role.EMPLOYEE) return Role.EMPLOYEE;

  return undefined;
}
