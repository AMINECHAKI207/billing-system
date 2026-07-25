import { Router } from 'express';
import { customerController } from './customer.controller';
import { authenticate } from '@middleware/authenticate';
import { requirePermission } from '@middleware/requirePermission';

const router = Router();

// List and Create
router.route('/')
  .get(authenticate, requirePermission('clients.view'), customerController.getAll)
  .post(authenticate, requirePermission('clients.create'), customerController.create);

// Read, Update, Delete single customer
router.route('/:id')
  .get(authenticate, requirePermission('clients.view'), customerController.getById)
  .put(authenticate, requirePermission('clients.update'), customerController.update)
  .delete(authenticate, requirePermission('clients.delete'), customerController.delete);

export default router;
