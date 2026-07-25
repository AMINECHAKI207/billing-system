import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '@utils/ApiResponse';
import { rbacService } from './rbac.service';
import {
  assignPermissionsSchema,
  assignUserRoleSchema,
  createRoleSchema,
  permissionSchema,
  roleIdParamSchema,
  updateRoleSchema,
  userIdParamSchema,
  assignClientsSchema,
} from './rbac.schema';

export const rbacController = {
  async listRoles(_req: Request, res: Response, next: NextFunction) {
    try { ApiResponse.success(res, { roles: await rbacService.listRoles() }, 'Roles retrieved successfully'); } catch (error) { next(error); }
  },
  async createRole(req: Request, res: Response, next: NextFunction) {
    try { ApiResponse.created(res, { role: await rbacService.createRole(createRoleSchema.parse(req).body) }, 'Role created successfully'); } catch (error) { next(error); }
  },
  async updateRole(req: Request, res: Response, next: NextFunction) {
    try { const input = updateRoleSchema.parse(req); ApiResponse.success(res, { role: await rbacService.updateRole(input.params.id, input.body) }, 'Role updated successfully'); } catch (error) { next(error); }
  },
  async deleteRole(req: Request, res: Response, next: NextFunction) {
    try { const { id } = roleIdParamSchema.parse(req).params; await rbacService.deleteRole(id); ApiResponse.success(res, null, 'Role deleted successfully'); } catch (error) { next(error); }
  },
  async listPermissions(_req: Request, res: Response, next: NextFunction) {
    try { ApiResponse.success(res, { permissions: await rbacService.listPermissions() }, 'Permissions retrieved successfully'); } catch (error) { next(error); }
  },
  async createPermission(req: Request, res: Response, next: NextFunction) {
    try { ApiResponse.created(res, { permission: await rbacService.createPermission(permissionSchema.parse(req).body) }, 'Permission created successfully'); } catch (error) { next(error); }
  },
  async deletePermission(req: Request, res: Response, next: NextFunction) {
    try { const { id } = roleIdParamSchema.parse(req).params; await rbacService.deletePermission(id); ApiResponse.success(res, null, 'Permission deleted successfully'); } catch (error) { next(error); }
  },
  async assignPermissions(req: Request, res: Response, next: NextFunction) {
    try { const input = assignPermissionsSchema.parse(req); ApiResponse.success(res, { role: await rbacService.assignPermissions(input.params.id, input.body.permissions) }, 'Permissions assigned successfully'); } catch (error) { next(error); }
  },
  async listUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const query = req.query as { page?: string; limit?: string; search?: string; roleId?: string };
      ApiResponse.success(res, await rbacService.listUsers(query), 'RBAC users retrieved successfully');
    } catch (error) { next(error); }
  },
  async assignUserRole(req: Request, res: Response, next: NextFunction) {
    try { const input = assignUserRoleSchema.parse(req); ApiResponse.success(res, { user: await rbacService.assignUserRole(input.params.id, input.body.roleId) }, 'User role assigned successfully'); } catch (error) { next(error); }
  },

  async getUserClients(req: Request, res: Response, next: NextFunction) {
    try { const { id } = userIdParamSchema.parse(req).params; ApiResponse.success(res, { clients: await rbacService.getUserClients(id) }, 'Assigned clients retrieved successfully'); } catch (error) { next(error); }
  },
  async assignUserClients(req: Request, res: Response, next: NextFunction) {
    try { const input = assignClientsSchema.parse(req); ApiResponse.success(res, { clients: await rbacService.assignUserClients(input.params.id, input.body.clientIds) }, 'Assigned clients updated successfully'); } catch (error) { next(error); }
  },
  parseUserId(req: Request) { return userIdParamSchema.parse(req).params.id; },
};
