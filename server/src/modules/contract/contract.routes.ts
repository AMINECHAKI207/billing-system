import rateLimit from 'express-rate-limit';
import { Router } from 'express';
import { authenticate } from '@middleware/authenticate';
import { requirePermission } from '@middleware/requirePermission';
import { contractController } from './contract.controller';

const router = Router();
const publicRouter = Router();

const contractEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const signatureLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(authenticate);

router.get('/templates', requirePermission('contract_templates.view'), contractController.listTemplates);

router.route('/')
  .get(requirePermission('contracts.view'), contractController.list)
  .post(requirePermission('contracts.create'), contractController.create);

router.route('/:id')
  .get(requirePermission('contracts.view'), contractController.getById)
  .patch(requirePermission('contracts.update'), contractController.update)
  .delete(requirePermission('contracts.delete'), contractController.remove);

router.patch('/:id/status', requirePermission('contracts.update'), contractController.updateStatus);
router.post('/:id/send', requirePermission('contracts.send'), contractController.send);
router.post('/:id/cancel', requirePermission('contracts.cancel'), contractController.cancel);
router.post('/:id/terminate', requirePermission('contracts.terminate'), contractController.terminate);
router.post('/:id/sign-company', requirePermission('contracts.sign.company'), contractController.signCompany);
router.post('/:id/signature/revoke', requirePermission('contracts.signature.revoke'), contractController.revokeSignature);
router.get('/:id/pdf/preview', requirePermission('contracts.pdf.preview'), contractController.previewPdf);
router.get('/:id/pdf', requirePermission('contracts.pdf.download'), contractController.downloadPdf);
router.post('/:id/email', requirePermission('contracts.email.send'), contractEmailLimiter, contractController.sendEmail);
router.get('/:id/email-history', requirePermission('contracts.email.history'), contractController.emailHistory);
router.post('/:id/time-entries', requirePermission('contracts.time_entries.create'), contractController.createTimeEntry);
router.patch('/:id/time-entries/:entryId', requirePermission('contracts.time_entries.update'), contractController.updateTimeEntry);
router.post('/:id/time-entries/:entryId/submit', requirePermission('contracts.time_entries.submit'), contractController.submitTimeEntry);
router.post('/:id/time-entries/:entryId/approve', requirePermission('contracts.time_entries.approve'), contractController.approveTimeEntry);
router.post('/:id/time-entries/:entryId/reject', requirePermission('contracts.time_entries.reject'), contractController.rejectTimeEntry);
router.post('/:id/milestones', requirePermission('contracts.milestones.manage'), contractController.createMilestone);
router.post('/:id/milestones/:milestoneId/approve', requirePermission('contracts.milestones.manage'), contractController.approveMilestone);
router.post('/:id/billing-schedule', requirePermission('contracts.pricing.manage'), contractController.createBillingScheduleItem);
router.post('/:id/generate-invoice', requirePermission('contracts.billing.generate'), contractController.generateInvoice);

publicRouter.get('/contracts/sign/:token', signatureLimiter, contractController.publicView);
publicRouter.post('/contracts/sign/:token', signatureLimiter, contractController.publicSign);

export { publicRouter as publicContractRouter };
export default router;
