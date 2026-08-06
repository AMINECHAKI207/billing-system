import { NextFunction, Request, Response } from 'express';
import { ApiResponse } from '@utils/ApiResponse';
import { aiAssistantService } from './aiAssistant.service';
import {
  aiConversationParamSchema,
  aiConversationSchema,
  aiHistoryQuerySchema,
  aiMessageSchema,
  aiPendingActionParamSchema,
  aiToolExecutionSchema,
} from './aiAssistant.schema';
import type { AssistantUser } from './tools/toolTypes';

export class AiAssistantController {
  async briefing(req: Request, res: Response, next: NextFunction) {
    try {
      const briefing = await aiAssistantService.briefing(req.user! as AssistantUser);
      ApiResponse.success(res, { briefing }, 'AI assistant briefing retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  tools(req: Request, res: Response, next: NextFunction) {
    try {
      ApiResponse.success(res, { tools: aiAssistantService.listTools(req.user! as AssistantUser) }, 'AI tools retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async createConversation(req: Request, res: Response, next: NextFunction) {
    try {
      const data = aiConversationSchema.parse(req).body;
      const conversation = await aiAssistantService.createConversation(req.user! as AssistantUser, data);
      ApiResponse.created(res, { conversation }, 'AI conversation created successfully');
    } catch (error) {
      next(error);
    }
  }

  async history(req: Request, res: Response, next: NextFunction) {
    try {
      const query = aiHistoryQuerySchema.parse(req).query;
      const result = await aiAssistantService.history(req.user! as AssistantUser, query.page, query.limit);
      ApiResponse.success(res, result, 'AI conversations retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async getConversation(req: Request, res: Response, next: NextFunction) {
    try {
      const { conversationId } = aiConversationParamSchema.parse(req).params;
      const conversation = await aiAssistantService.getConversation(req.user! as AssistantUser, conversationId);
      ApiResponse.success(res, { conversation }, 'AI conversation retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async archiveConversation(req: Request, res: Response, next: NextFunction) {
    try {
      const { conversationId } = aiConversationParamSchema.parse(req).params;
      const conversation = await aiAssistantService.archiveConversation(req.user! as AssistantUser, conversationId);
      ApiResponse.success(res, { conversation }, 'AI conversation archived successfully');
    } catch (error) {
      next(error);
    }
  }

  async sendMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const { params, body } = aiMessageSchema.parse(req);
      const result = await aiAssistantService.sendMessage(req.user! as AssistantUser, params.conversationId, body);
      ApiResponse.success(res, result, 'AI assistant response created successfully');
    } catch (error) {
      next(error);
    }
  }

  async executeTool(req: Request, res: Response, next: NextFunction) {
    try {
      const { body } = aiToolExecutionSchema.parse(req);
      const result = await aiAssistantService.executeTool(req.user! as AssistantUser, body);
      ApiResponse.success(res, result, 'AI tool processed successfully');
    } catch (error) {
      next(error);
    }
  }

  async confirmAction(req: Request, res: Response, next: NextFunction) {
    try {
      const { actionId } = aiPendingActionParamSchema.parse(req).params;
      const result = await aiAssistantService.confirmAction(req.user! as AssistantUser, actionId);
      ApiResponse.success(res, result, 'AI action confirmed successfully');
    } catch (error) {
      next(error);
    }
  }

  async cancelAction(req: Request, res: Response, next: NextFunction) {
    try {
      const { actionId } = aiPendingActionParamSchema.parse(req).params;
      const action = await aiAssistantService.cancelAction(req.user! as AssistantUser, actionId);
      ApiResponse.success(res, { action }, 'AI action cancelled successfully');
    } catch (error) {
      next(error);
    }
  }
}

export const aiAssistantController = new AiAssistantController();
