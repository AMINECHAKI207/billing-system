import { Router } from 'express';
import { authenticate } from '@middleware/authenticate';
import { requirePermission } from '@middleware/requirePermission';
import { creditNoteController } from './creditNote.controller';

const router = Router();

router.use(authenticate);

router.route('/reasons')
  .get(requirePermission('credit_note_reasons.view'), creditNoteController.getReasons)
  .post(requirePermission('credit_note_reasons.manage'), creditNoteController.createReason);

router.patch('/reasons/:id', requirePermission('credit_note_reasons.manage'), creditNoteController.updateReason);

router.route('/')
  .get(requirePermission('credit_notes.view'), creditNoteController.getAll)
  .post(requirePermission('credit_notes.create'), creditNoteController.create);

router.route('/:id')
  .get(requirePermission('credit_notes.view'), creditNoteController.getById)
  .patch(requirePermission('credit_notes.update'), creditNoteController.update)
  .delete(requirePermission('credit_notes.update'), creditNoteController.remove);

router.post('/:id/validate', requirePermission('credit_notes.validate'), creditNoteController.validate);
router.post('/:id/cancel', requirePermission('credit_notes.cancel'), creditNoteController.cancel);
router.post('/:id/refund', requirePermission('credit_notes.refund'), creditNoteController.refund);
router.get('/:id/pdf', requirePermission('credit_notes.pdf.download'), creditNoteController.downloadPdf);
router.post('/:id/email', requirePermission('credit_notes.email.send'), creditNoteController.sendEmail);

export default router;
