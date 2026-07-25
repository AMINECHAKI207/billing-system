import { PermissionScope, Prisma } from '@prisma/client';
import { ApiError } from '@utils/ApiError';

export type ScopeMap = Record<string, PermissionScope>;

export function permissionScope(scopes: ScopeMap | undefined, permission: string): PermissionScope {
  const scope = scopes?.[permission];
  if (!scope) throw ApiError.forbidden(`Permission scope missing for ${permission}`);
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

export function paymentAccessWhere(userId: string, scope: PermissionScope): Prisma.PaymentWhereInput {
  return { invoice: { customer: customerAccessWhere(userId, scope) } };
}
