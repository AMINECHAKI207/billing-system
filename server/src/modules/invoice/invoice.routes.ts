import { Router } from 'express';
import { authenticate } from '@middleware/authenticate';
import { requirePermission } from '@middleware/requirePermission';
import { invoiceController } from './invoice.controller';

const router = Router();

router.use(authenticate);

router.get('/dashboard', requirePermission('invoices.view'), invoiceController.getDashboard);
router.get('/export/excel', requirePermission('invoices.view'), invoiceController.exportExcel);

router.route('/')
  .get(requirePermission('invoices.view'), invoiceController.getAll)
  .post(requirePermission('invoices.create'), invoiceController.create);

router.route('/:id')
  .get(requirePermission('invoices.view'), invoiceController.getById)
  .put(requirePermission('invoices.update'), invoiceController.update);

router.get('/:id/pdf', requirePermission('invoices.view'), invoiceController.downloadPdf);
router.post('/:id/sign', requirePermission('invoices.sign'), invoiceController.sign);
router.delete('/:id/sign', requirePermission('invoices.sign'), invoiceController.cancelSignature);
router.post('/:id/email', requirePermission('invoices.send'), invoiceController.sendEmail);
router.patch('/:id/status', requirePermission('invoices.update'), invoiceController.updateStatus);
router.post('/:id/payments', requirePermission('payments.create'), invoiceController.addPayment);

export default router;
