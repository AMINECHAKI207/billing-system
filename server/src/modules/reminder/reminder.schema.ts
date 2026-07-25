import { ReminderStatus, ReminderType } from '@prisma/client';
import { z } from 'zod';

export const createReminderSchema = z.object({
  body: z.object({
    invoiceId: z.string().uuid(),
    type: z.nativeEnum(ReminderType).default(ReminderType.MANUAL),
    recipientEmail: z.string().email().optional(),
    subject: z.string().min(3).max(255).optional(),
    body: z.string().min(10).optional(),
    sendEmail: z.coerce.boolean().default(true),
  }),
});

export const reminderQuerySchema = z.object({
  query: z.object({
    page: z.string().regex(/^\d+$/).optional(),
    limit: z.string().regex(/^\d+$/).optional(),
    invoiceId: z.string().uuid().optional(),
    status: z.nativeEnum(ReminderStatus).optional(),
    type: z.nativeEnum(ReminderType).optional(),
    search: z.string().trim().optional(),
  }),
});

export type CreateReminderInput = z.infer<typeof createReminderSchema>['body'];
export type ReminderQueryInput = z.infer<typeof reminderQuerySchema>['query'];
