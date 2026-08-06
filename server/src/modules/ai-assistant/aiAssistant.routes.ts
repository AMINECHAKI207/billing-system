import rateLimit from 'express-rate-limit';
import { Router } from 'express';
import { authenticate } from '@middleware/authenticate';
import { requirePermission } from '@middleware/requirePermission';
import { aiAssistantController } from './aiAssistant.controller';
import { AI_ASSISTANT_PERMISSIONS } from './aiAssistant.permissions';

const router = Router();

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(authenticate);
router.use(requirePermission(AI_ASSISTANT_PERMISSIONS.access));
router.use(aiLimiter);

router.get('/briefing', requirePermission(AI_ASSISTANT_PERMISSIONS.useReadTools), aiAssistantController.briefing);
router.get('/tools', requirePermission(AI_ASSISTANT_PERMISSIONS.useReadTools), aiAssistantController.tools);
router.get('/conversations', requirePermission(AI_ASSISTANT_PERMISSIONS.viewHistory), aiAssistantController.history);
router.post('/conversations', aiAssistantController.createConversation);
router.get('/conversations/:conversationId', requirePermission(AI_ASSISTANT_PERMISSIONS.viewHistory), aiAssistantController.getConversation);
router.post('/conversations/:conversationId/archive', requirePermission(AI_ASSISTANT_PERMISSIONS.viewHistory), aiAssistantController.archiveConversation);
router.post('/conversations/:conversationId/messages', aiAssistantController.sendMessage);
router.post('/tools/execute', aiAssistantController.executeTool);
router.post('/actions/:actionId/confirm', requirePermission(AI_ASSISTANT_PERMISSIONS.confirmActions), aiAssistantController.confirmAction);
router.post('/actions/:actionId/cancel', aiAssistantController.cancelAction);

export default router;
