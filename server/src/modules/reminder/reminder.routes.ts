import { Router } from 'express';
import { authenticate } from '@middleware/authenticate';
import { requirePermission } from '@middleware/requirePermission';
import { reminderController } from './reminder.controller';

const router = Router();

router.use(authenticate);

router.post('/run-due', requirePermission('reminders.manage'), reminderController.runAutomatic);

router.route('/')
  .get(requirePermission('reminders.view'), reminderController.getAll)
  .post(requirePermission('reminders.create'), reminderController.create);

export default router;
