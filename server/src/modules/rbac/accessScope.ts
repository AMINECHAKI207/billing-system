import { PermissionScope, Prisma } from '@prisma/client';
import { ApiError } from '@utils/ApiError';

export type ScopeMap = Record<string, PermissionScope>;

export type AuthorizationResult = {
  allowed: boolean;
  permission: string;
  scope: PermissionScope | null;
  reason: 'ALLOWED' | 'MISSING_PERMISSION' | 'MISSING_SCOPE' | 'INVALID_SCOPE';
};

export function authorizePermission({
  permissions,
  scopes,
  permission,
}: {
  userId?: string;
  permissions?: string[];
  scopes?: ScopeMap;
  permission: string;
}): AuthorizationResult {
  if (permissions && !permissions.includes(permission)) {
    return { allowed: false, permission, scope: null, reason: 'MISSING_PERMISSION' };
  }
  const scope = scopes?.[permission];
  if (!scope) return { allowed: false, permission, scope: null, reason: 'MISSING_SCOPE' };
  if (!Object.values(PermissionScope).includes(scope)) {
    return { allowed: false, permission, scope: null, reason: 'INVALID_SCOPE' };
  }
  return { allowed: true, permission, scope, reason: 'ALLOWED' };
}

export function permissionScope(scopes: ScopeMap | undefined, permission: string): PermissionScope {
  const scope = scopes?.[permission];
  if (!scope) throw ApiError.forbidden('You are not allowed to access this resource.');
  return scope;
}

export function customerAccessWhere(userId: string, scope: PermissionScope): Prisma.CustomerWhereInput {
  switch (scope) {
    case PermissionScope.ALL: return {};
    case PermissionScope.OWN: return { createdById: userId };
    case PermissionScope.SELECTED: return { assignedUsers: { some: { userId } } };
    default: throw ApiError.forbidden('Unsupported permission scope');
  }
}

export function invoiceAccessWhere(userId: string, scope: PermissionScope): Prisma.InvoiceWhereInput {
  return { customer: customerAccessWhere(userId, scope) };
}

export function creditNoteAccessWhere(userId: string, scope: PermissionScope): Prisma.CreditNoteWhereInput {
  return { invoice: invoiceAccessWhere(userId, scope) };
}

export function devisAccessWhere(userId: string, scope: PermissionScope): Prisma.DevisWhereInput {
  return { customer: customerAccessWhere(userId, scope) };
}

export function contractAccessWhere(userId: string, scope: PermissionScope): Prisma.ContractWhereInput {
  return { client: customerAccessWhere(userId, scope) };
}

export function paymentAccessWhere(userId: string, scope: PermissionScope): Prisma.PaymentWhereInput {
  return { invoice: { customer: customerAccessWhere(userId, scope) } };
}

export function expenseNoteAccessWhere(userId: string, scope: PermissionScope): Prisma.ExpenseNoteWhereInput {
  switch (scope) {
    case PermissionScope.ALL:
      return {};
    case PermissionScope.OWN:
    case PermissionScope.SELECTED:
      return { createdById: userId };
    default:
      throw ApiError.forbidden('Unsupported permission scope');
  }
}
