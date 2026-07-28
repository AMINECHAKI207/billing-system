import { Router } from 'express';
import { authenticate } from '@middleware/authenticate';
import { requirePermission } from '@middleware/requirePermission';
import { devisController } from './devis.controller';

const router = Router();

router.use(authenticate);

router.route('/')
  .get(requirePermission('devis.view'), devisController.getAll)
  .post(requirePermission('devis.create'), devisController.create);

router.delete('/drafts', requirePermission('devis.delete'), devisController.removeDrafts);

router.route('/:id')
  .get(requirePermission('devis.view'), devisController.getById)
  .patch(requirePermission('devis.update'), devisController.update)
  .delete(requirePermission('devis.delete'), devisController.remove);

router.get('/:id/pdf', requirePermission('devis.download'), devisController.downloadPdf);
router.post('/:id/sign', requirePermission('devis.sign'), devisController.sign);
router.delete('/:id/sign', requirePermission('devis.sign'), devisController.cancelSignature);
router.patch('/:id/status', requirePermission('devis.update'), devisController.updateStatus);
router.post('/:id/send', requirePermission('devis.send'), devisController.send);
router.post('/:id/approve', requirePermission('devis.approve'), devisController.approve);
router.post('/:id/reject', requirePermission('devis.reject'), devisController.reject);
router.post('/:id/convert-to-invoice', requirePermission('devis.convert', 'invoices.create'), devisController.convertToInvoice);

export default router;
