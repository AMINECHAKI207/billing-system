import { Router } from 'express';
import { authenticate } from '@middleware/authenticate';
import { requirePermission } from '@middleware/requirePermission';
import { auditController } from './audit.controller';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('audit_logs.view'), auditController.list);
router.get('/export', requirePermission('audit_logs.export'), auditController.export);
router.get('/timeline/:entity/:entityId', requirePermission('audit_logs.view'), auditController.timeline);

export default router;
