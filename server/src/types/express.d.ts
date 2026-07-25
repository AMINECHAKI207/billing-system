import type { PermissionScope, Role } from '@prisma/client';

/**
 * Express Request Augmentation
 *
 * TypeScript doesn't know about req.user by default.
 * This declaration merges our user type into Express's Request interface.
 *
 * After this, anywhere you access req.user, TypeScript knows
 * it has { id, name, email, role, isActive }.
 *
 * WHY: Without this, you'd need (req as any).user everywhere —
 * defeating the purpose of TypeScript.
 */
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        name: string;
        email: string;
        role: Role;
        themePreference: string;
        isActive: boolean;
        rbacRoleId: string | null;
        permissions: string[];
        permissionScopes?: Record<string, PermissionScope>;
      };
    }
  }
}

export {};
