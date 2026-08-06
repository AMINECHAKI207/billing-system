import { PermissionScope, Prisma } from '@prisma/client';
import { prisma } from '@config/database';
import { ApiError } from '@utils/ApiError';
import { parsePagination } from '@utils/pagination';
import {
  CreateRoleInput,
  PermissionInput,
  UpdateRoleInput,
  RolePermissionInput,
} from './rbac.schema';

const roleInclude = {
  permissions: { include: { permission: true } },
  _count: { select: { users: true } },
} satisfies Prisma.RbacRoleInclude;

export class RbacService {
  async userHasPermission(userId: string, permissionKey: string) {
    const count = await prisma.rolePermission.count({
      where: {
        permission: { key: permissionKey },
        role: { users: { some: { id: userId } } },
      },
    });
    return count > 0;
  }

  listRoles() {
    return prisma.rbacRole.findMany({
      include: roleInclude,
      orderBy: { name: 'asc' },
    });
  }

  async createRole(data: CreateRoleInput) {
    return prisma.rbacRole.create({
      data: { name: data.name.toUpperCase(), description: data.description },
      include: roleInclude,
    });
  }

  async updateRole(id: string, data: UpdateRoleInput) {
    const role = await prisma.rbacRole.findUnique({ where: { id } });
    if (!role) throw ApiError.notFound('Role');
    if (role.isSystem && data.name && data.name.toUpperCase() !== role.name) {
      throw ApiError.badRequest('System roles cannot be renamed');
    }
    return prisma.rbacRole.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name.toUpperCase() }),
        ...(data.description !== undefined && { description: data.description }),
      },
      include: roleInclude,
    });
  }

  async deleteRole(id: string) {
    const role = await prisma.rbacRole.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw ApiError.notFound('Role');
    if (role.isSystem) throw ApiError.badRequest('System roles cannot be deleted');
    if (role._count.users > 0) throw ApiError.conflict('Role is assigned to users');
    await prisma.rbacRole.delete({ where: { id } });
  }

  listPermissions() {
    return prisma.permission.findMany({ orderBy: [{ resource: 'asc' }, { action: 'asc' }] });
  }

  async createPermission(data: PermissionInput) {
    const parts = data.key.split('.');
    return prisma.permission.create({
      data: {
        key: data.key,
        description: data.description,
        resource: parts[0] ?? data.key,
        action: parts.slice(1).join('.'),
      },
    });
  }

  async deletePermission(id: string) {
    const permission = await prisma.permission.findUnique({ where: { id } });
    if (!permission) throw ApiError.notFound('Permission');
    await prisma.permission.delete({ where: { id } });
  }

  async assignPermissions(roleId: string, permissions: RolePermissionInput[]) {
    const role = await prisma.rbacRole.findUnique({ where: { id: roleId } });
    if (!role) throw ApiError.notFound('Role');
    const permissionIds = permissions.map((item) => item.permissionId);
    if (new Set(permissionIds).size !== permissionIds.length) throw ApiError.badRequest('Duplicate permissions are not allowed');
    const stored = await prisma.permission.findMany({ where: { id: { in: permissionIds } }, select: { id: true, resource: true } });
    if (stored.length !== permissionIds.length) throw ApiError.badRequest('One or more permissions are invalid');
    const scopedResources = new Set([
      'clients',
      'customers',
      'invoices',
      'payments',
      'recurring',
      'credit_notes',
      'contracts',
      'devis',
      'expense_notes',
      'expense_attachments',
    ]);
    for (const item of permissions) {
      const permission = stored.find((entry) => entry.id === item.permissionId)!;
      if (!scopedResources.has(permission.resource) && item.scope !== PermissionScope.ALL) {
        throw ApiError.badRequest(`Scope ${item.scope} is not supported for ${permission.resource}`);
      }
    }
    await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      if (permissions.length) await tx.rolePermission.createMany({ data: permissions.map((item) => ({ roleId, permissionId: item.permissionId, scope: item.scope })) });
    });
    return prisma.rbacRole.findUnique({ where: { id: roleId }, include: roleInclude });
  }

  async assignUserRole(userId: string, roleId: string) {
    const [user, role] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.rbacRole.findUnique({ where: { id: roleId } }),
    ]);
    if (!user) throw ApiError.notFound('User');
    if (!role) throw ApiError.notFound('Role');
    return prisma.user.update({
      where: { id: userId },
      data: { rbacRoleId: role.id, role: role.name === 'ADMIN' ? 'ADMIN' : 'EMPLOYEE' },
      select: { id: true, name: true, email: true, role: true, rbacRole: { select: { id: true, name: true } } },
    });
  }

  async getUserClients(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw ApiError.notFound('User');
    return prisma.customer.findMany({
      where: { assignedUsers: { some: { userId } } } as unknown as Prisma.CustomerWhereInput,
      select: { id: true, name: true, company: true, email: true },
      orderBy: { name: 'asc' },
    });
  }

  async assignUserClients(userId: string, clientIds: string[]) {
    const [user, count] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
      prisma.customer.count({ where: { id: { in: clientIds } } }),
    ]);
    if (!user) throw ApiError.notFound('User');
    if (count !== new Set(clientIds).size) throw ApiError.badRequest('One or more clients are invalid');
    await prisma.$transaction(async (tx) => {
      await tx.userClientAssignment.deleteMany({ where: { userId } });
      if (clientIds.length) await tx.userClientAssignment.createMany({ data: [...new Set(clientIds)].map((clientId) => ({ userId, clientId })) });
    });
    return this.getUserClients(userId);
  }

  async listUsers(query: { page?: string; limit?: string; search?: string; roleId?: string }) {
    const { skip, limit, page } = parsePagination({ page: query.page, limit: query.limit });
    const where: Prisma.UserWhereInput = {
      ...(query.roleId && { rbacRoleId: query.roleId }),
      ...(query.search && { OR: [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ] }),
    };
    const [data, total] = await Promise.all([
      prisma.user.findMany({
        where, skip, take: limit, orderBy: { name: 'asc' },
        select: { id: true, name: true, email: true, isActive: true, role: true, rbacRole: { select: { id: true, name: true } } },
      }),
      prisma.user.count({ where }),
    ]);
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }
}

export const rbacService = new RbacService();
