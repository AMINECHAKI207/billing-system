import { Router } from 'express';
import { authenticate } from '@middleware/authenticate';
import { requirePermission } from '@middleware/requirePermission';
import { productController } from './product.controller';

const router = Router();

router.use(authenticate);

router
  .route('/')
  .get(requirePermission('products.view'), productController.getAll)
  .post(requirePermission('products.create'), productController.create);

router.put('/:id', requirePermission('products.update'), productController.update);

export default router;
