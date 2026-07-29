import { NextFunction, Request, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '@middleware/authenticate';
import { requirePermission } from '@middleware/requirePermission';
import { expenseController } from './expense.controller';
import { uploadReceiptField } from './expense.upload';

const router = Router();
const aiAnalyzeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});
const emailLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

function requireExpensePdfPermission(req: Request, res: Response, next: NextFunction) {
  const permission = req.query.disposition === 'inline'
    ? 'expense_notes.pdf.print'
    : 'expense_notes.pdf.download';
  return requirePermission(permission)(req, res, next);
}

function requireExpenseExportPermission(req: Request, res: Response, next: NextFunction) {
  const format = String(req.body?.format ?? 'excel');
  const permission = format === 'excel'
    ? 'expense_notes.export.excel'
    : format === 'csv'
      ? 'expense_notes.report.export'
      : 'expense_notes.pdf.bulk_export';
  return requirePermission(permission)(req, res, next);
}

router.use(authenticate);

router
  .route('/categories')
  .get(requirePermission('expense_notes.view'), expenseController.listCategories)
  .post(requirePermission('expense_categories.manage'), expenseController.createCategory);

router.patch('/categories/:id', requirePermission('expense_categories.manage'), expenseController.updateCategory);

router
  .route('/types')
  .get(requirePermission('expense_notes.view'), expenseController.listTypes)
  .post(requirePermission('expense_types.manage'), expenseController.createType);

router.patch('/types/:id', requirePermission('expense_types.manage'), expenseController.updateType);

router.post(
  '/analyze-receipt',
  requirePermission('expense_notes.analyze'),
  aiAnalyzeLimiter,
  uploadReceiptField('receipt'),
  expenseController.analyzeReceipt
);

router.get('/attachments/:attachmentId/download', requirePermission('expense_attachments.view'), expenseController.downloadAttachment);
router.delete('/attachments/:attachmentId', requirePermission('expense_notes.update'), expenseController.deleteAttachment);
router.post('/export', requireExpenseExportPermission, expenseController.exportNotes);
router.post('/email-logs/:emailLogId/resend', requirePermission('expense_notes.email.resend'), emailLimiter, expenseController.resendEmail);
router.get('/analytics', requirePermission('expense_notes.view'), expenseController.analytics);

router
  .route('/')
  .get(requirePermission('expense_notes.view'), expenseController.listNotes)
  .post(requirePermission('expense_notes.create'), expenseController.createNote);

router
  .route('/:id')
  .get(requirePermission('expense_notes.view'), expenseController.getNote)
  .patch(requirePermission('expense_notes.update'), expenseController.updateNote)
  .delete(requirePermission('expense_notes.delete'), expenseController.deleteNote);

router.post('/:id/submit', requirePermission('expense_notes.submit'), expenseController.submitNote);
router.post('/:id/approve', requirePermission('expense_notes.approve'), expenseController.approveNote);
router.post('/:id/reject', requirePermission('expense_notes.reject'), expenseController.rejectNote);
router.post('/:id/request-changes', requirePermission('expense_notes.request_changes'), expenseController.requestChanges);
router.post('/:id/mark-paid', requirePermission('expense_notes.mark_paid'), expenseController.markPaid);
router.get('/:id/pdf/preview', requirePermission('expense_notes.pdf.preview'), expenseController.previewPdf);
router.get('/:id/pdf', requireExpensePdfPermission, expenseController.downloadPdf);
router.post('/:id/email', requirePermission('expense_notes.email.send'), emailLimiter, expenseController.sendEmail);
router.get('/:id/email-history', requirePermission('expense_notes.email.history'), expenseController.emailHistory);

export default router;
