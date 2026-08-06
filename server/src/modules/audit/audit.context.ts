import { AsyncLocalStorage } from 'async_hooks';
import type { PermissionScope, Role } from '@prisma/client';

export type AuditContext = {
  userId?: string;
  userRole?: Role;
  permissions?: string[];
  permissionScopes?: Record<string, PermissionScope>;
  ipAddress?: string;
  userAgent?: string;
  browser?: string;
  operatingSystem?: string;
  device?: string;
  requestId?: string;
  sessionId?: string;
  httpMethod?: string;
  route?: string;
  statusCode?: number;
  success?: boolean;
  executionTime?: number;
  startedAt?: number;
};

const storage = new AsyncLocalStorage<AuditContext>();

export function runWithAuditContext<T>(context: AuditContext, callback: () => T): T {
  return storage.run(context, () => {
    storage.enterWith(context);
    return callback();
  });
}

export function getAuditContext(): AuditContext | undefined {
  return storage.getStore();
}

export function mergeAuditContext(context: Partial<AuditContext>): void {
  const current = storage.getStore();
  if (!current) return;
  Object.assign(current, context);
}
