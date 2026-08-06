import { Router } from 'express';
import { authenticate } from '@middleware/authenticate';
import { requirePermission } from '@middleware/requirePermission';
import { creditNoteController } from './creditNote.controller';

const router = Router();

router.use(authenticate);

router.route('/')
  .get(requirePermission('credit_note_reasons.view'), creditNoteController.getReasons)
  .post(requirePermission('credit_note_reasons.manage'), creditNoteController.createReason);

router.patch('/:id', requirePermission('credit_note_reasons.manage'), creditNoteController.updateReason);

export default router;
