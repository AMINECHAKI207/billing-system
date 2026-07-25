import { Router } from 'express';
import { authenticate } from '@middleware/authenticate';
import { requirePermission } from '@middleware/requirePermission';
import { reportController } from './report.controller';

const router = Router();

router.use(authenticate);

router.get('/receivables-aging', requirePermission('reports.view'), reportController.receivablesAging);
router.get('/tax-summary', requirePermission('reports.view'), reportController.taxSummary);

export default router;
