import { Request, Response, NextFunction } from 'express';
import { prisma } from '@config/database';
import { PermissionScope } from '@prisma/client';
import { ApiError } from '@utils/ApiError';
import { attachAuditUser } from './auditContext';

export const requirePermission = (...requiredPermissions: string[]) => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) throw ApiError.unauthorized('Not authenticated');
      if (requiredPermissions.length === 0) throw ApiError.forbidden('No permission requested');

      let user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: {
          rbacRole: {
            select: {
              permissions: {
                where: { permission: { key: { in: requiredPermissions } } },
                select: { scope: true, permission: { select: { key: true } } },
              },
            },
          },
        },
      });

      if (user && !user.rbacRole) {
        const legacyRoleName = String(req.user.role).toUpperCase();
        if (legacyRoleName === 'ADMIN' || legacyRoleName === 'EMPLOYEE') {
          await prisma.user.update({ where: { id: req.user.id }, data: { rbacRole: { connect: { name: legacyRoleName } } } });
          user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: { rbacRole: { select: { permissions: {
              where: { permission: { key: { in: requiredPermissions } } },
              select: { scope: true, permission: { select: { key: true } } },
            } } } },
          });
        }
      }

      const grants = user?.rbacRole?.permissions ?? [];
      const grantedKeys = new Set(grants.map((grant) => grant.permission.key));
      const missing = requiredPermissions.filter((key) => !grantedKeys.has(key));
      if (missing.length) throw ApiError.forbidden(`Missing permission: ${missing.join(', ')}`);

      const scopes = Object.fromEntries(grants.map((grant) => [grant.permission.key, grant.scope ?? PermissionScope.ALL]));
      req.user.permissionScopes = { ...(req.user.permissionScopes ?? {}), ...scopes };
      attachAuditUser(req);
      next();
    } catch (error) { next(error); }
  };
};
