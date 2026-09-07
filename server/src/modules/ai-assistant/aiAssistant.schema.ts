import { z } from 'zod';

const uuid = z.string().uuid();
const language = z.enum(['fr', 'en', 'ar']).default('fr');

export const aiConversationSchema = z.object({
  body: z.object({
    title: z.string().trim().min(2).max(255).optional(),
    language,
  }).optional().default({ language: 'fr' }),
});

export const aiConversationParamSchema = z.object({
  params: z.object({
    conversationId: uuid,
  }),
});

export const aiMessageSchema = z.object({
  params: z.object({
    conversationId: uuid,
  }),
  body: z.object({
    content: z.string().trim().min(1).max(4000),
    language,
    context: z.object({
      entityType: z.enum(['contract', 'invoice', 'quote', 'timesheet', 'client']).optional(),
      entityId: uuid.optional(),
      readableReference: z.string().trim().max(160).optional(),
    }).optional(),
  }),
});

export const aiPendingActionParamSchema = z.object({
  params: z.object({
    actionId: uuid,
  }),
});

export const aiToolExecutionSchema = z.object({
  body: z.object({
    toolName: z.string().trim().min(2).max(120),
    input: z.record(z.unknown()).default({}),
    conversationId: uuid.optional(),
    language: language.optional(),
    idempotencyKey: z.string().trim().min(8).max(160).optional(),
    replaceActionId: uuid.optional(),
  }),
});

export const aiHistoryQuerySchema = z.object({
  query: z.object({
    page: z.string().optional().default('1').transform(Number).pipe(z.number().int().min(1)),
    limit: z.string().optional().default('20').transform(Number).pipe(z.number().int().min(1).max(50)),
  }),
});

export type AiMessageInput = z.infer<typeof aiMessageSchema>['body'];
export type AiToolExecutionInput = z.infer<typeof aiToolExecutionSchema>['body'];
