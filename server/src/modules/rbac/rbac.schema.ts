import { PermissionScope } from '@prisma/client';
import { z } from 'zod';

const id = z.string().uuid();
const scope = z.nativeEnum(PermissionScope);

export const roleIdParamSchema = z.object({ params: z.object({ id }) });
export const userIdParamSchema = z.object({ params: z.object({ id }) });
export const createRoleSchema = z.object({ body: z.object({
  name: z.string().trim().min(2).max(100).regex(/^[A-Za-z0-9 _-]+$/),
  description: z.string().trim().max(500).optional(),
}) });
export const updateRoleSchema = z.object({ params: z.object({ id }), body: z.object({
  name: z.string().trim().min(2).max(100).regex(/^[A-Za-z0-9 _-]+$/).optional(),
  description: z.string().trim().max(500).nullable().optional(),
}) });
export const permissionSchema = z.object({ body: z.object({
  key: z.string().trim().min(3).max(120).regex(/^[a-z]+[a-z0-9]*(\.[a-z0-9_]+)+$/),
  description: z.string().trim().max(500).optional(),
}) });
export const assignPermissionsSchema = z.object({ params: z.object({ id }), body: z.object({
  permissions: z.array(z.object({ permissionId: id, scope })).max(200),
}) });
export const assignUserRoleSchema = z.object({ params: z.object({ id }), body: z.object({ roleId: id }) });
export const assignClientsSchema = z.object({ params: z.object({ id }), body: z.object({ clientIds: z.array(id).max(500) }) });

export type CreateRoleInput = z.infer<typeof createRoleSchema>['body'];
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>['body'];
export type PermissionInput = z.infer<typeof permissionSchema>['body'];
export type RolePermissionInput = z.infer<typeof assignPermissionsSchema>['body']['permissions'][number];
