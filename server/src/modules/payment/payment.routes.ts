import { Router } from 'express';
import { authenticate } from '@middleware/authenticate';
import { requirePermission } from '@middleware/requirePermission';
import { paymentController } from './payment.controller';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('payments.view'), paymentController.getAll);

export default router;
