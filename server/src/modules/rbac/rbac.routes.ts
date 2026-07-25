import { Router } from 'express';
import { authenticate } from '@middleware/authenticate';
import { requirePermission } from '@middleware/requirePermission';
import { rbacController } from './rbac.controller';

const router = Router();
router.use(authenticate);

router.get('/roles', requirePermission('roles.view'), rbacController.listRoles);
router.post('/roles', requirePermission('roles.create'), rbacController.createRole);
router.put('/roles/:id', requirePermission('roles.update'), rbacController.updateRole);
router.delete('/roles/:id', requirePermission('roles.delete'), rbacController.deleteRole);
router.put('/roles/:id/permissions', requirePermission('permissions.assign'), rbacController.assignPermissions);

router.get('/permissions', requirePermission('permissions.view'), rbacController.listPermissions);
router.post('/permissions', requirePermission('permissions.assign'), rbacController.createPermission);
router.delete('/permissions/:id', requirePermission('permissions.assign'), rbacController.deletePermission);

router.get('/users', requirePermission('users.view'), rbacController.listUsers);
router.put('/users/:id/role', requirePermission('permissions.assign'), rbacController.assignUserRole);
router.get('/users/:id/clients', requirePermission('users.view'), rbacController.getUserClients);
router.put('/users/:id/clients', requirePermission('permissions.assign'), rbacController.assignUserClients);

export default router;
