import { Router } from 'express';
import { authenticate } from '@middleware/authenticate';
import { requirePermission } from '@middleware/requirePermission';
import { userController } from './user.controller';

const router = Router();

router.use(authenticate);

router
  .route('/')
  .get(requirePermission('users.view'), userController.getAll)
  .post(requirePermission('users.create'), userController.create);

router.put('/:id', requirePermission('users.update'), userController.update);

export default router;
