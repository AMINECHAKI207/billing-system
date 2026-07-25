import { Router } from 'express';
import { authenticate } from '@middleware/authenticate';
import { requirePermission } from '@middleware/requirePermission';
import { settingsController } from './settings.controller';
import { uploadCompanyAssetField } from './companyAssetUpload';

const router = Router();

router.use(authenticate);

router
  .route('/company')
  .get(requirePermission('settings.view'), settingsController.getCompany)
  .put(requirePermission('settings.update'), settingsController.updateCompany);

router.post(
  '/company/signature',
  requirePermission('settings.update'),
  uploadCompanyAssetField('file'),
  settingsController.uploadSignature
);
router.delete('/company/signature', requirePermission('settings.update'), settingsController.deleteSignature);
router.post(
  '/company/signature/remove-background',
  requirePermission('settings.update'),
  settingsController.removeSignatureBackground
);
router.post(
  '/company/remove-background-preview',
  requirePermission('settings.update'),
  uploadCompanyAssetField('file'),
  settingsController.removeBackgroundPreview
);
router.post(
  '/company/stamp',
  requirePermission('settings.update'),
  uploadCompanyAssetField('file'),
  settingsController.uploadStamp
);
router.delete('/company/stamp', requirePermission('settings.update'), settingsController.deleteStamp);
router.post(
  '/company/stamp/remove-background',
  requirePermission('settings.update'),
  settingsController.removeStampBackground
);

router.get('/email-status', requirePermission('settings.update'), settingsController.getEmailStatus);
router.post('/email-test', requirePermission('settings.update'), settingsController.sendTestEmail);
router.get('/email-logs', requirePermission('settings.view'), settingsController.getEmailLogs);

export default router;
