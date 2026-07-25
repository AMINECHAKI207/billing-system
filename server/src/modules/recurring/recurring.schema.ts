import { RecurringFrequency, RecurringPlanStatus } from '@prisma/client';
import { z } from 'zod';

const dateString = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date');
const itemSchema = z.object({
  description: z.string().min(2).max(1000),
  unit: z.string().max(50).optional().nullable(),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  taxRate: z.coerce.number().min(0).max(100).default(0),
});

export const createRecurringPlanSchema = z.object({ body: z.object({
  customerId: z.string().uuid(),
  name: z.string().min(2).max(255),
  frequency: z.nativeEnum(RecurringFrequency),
  intervalCount: z.coerce.number().int().min(1).max(24).default(1),
  startDate: dateString,
  endDate: dateString.optional().nullable(),
  dueDays: z.coerce.number().int().min(0).max(365).default(30),
  autoSend: z.coerce.boolean().default(false),
  currency: z.string().min(3).max(10).default('MAD'),
  discount: z.coerce.number().min(0).default(0),
  notes: z.string().max(5000).optional().nullable(),
  terms: z.string().max(5000).optional().nullable(),
  items: z.array(itemSchema).min(1),
}) });

export const updateRecurringPlanSchema = z.object({ body: createRecurringPlanSchema.shape.body.partial() });
export const recurringPlanQuerySchema = z.object({ query: z.object({
  page: z.string().regex(/^\d+$/).optional(), limit: z.string().regex(/^\d+$/).optional(),
  search: z.string().optional(), status: z.nativeEnum(RecurringPlanStatus).optional(),
  customerId: z.string().uuid().optional(),
}) });
export const updateRecurringStatusSchema = z.object({ body: z.object({ status: z.enum(['ACTIVE','PAUSED','CANCELLED']) }) });

export type CreateRecurringPlanInput = z.infer<typeof createRecurringPlanSchema>['body'];
export type UpdateRecurringPlanInput = z.infer<typeof updateRecurringPlanSchema>['body'];
export type RecurringPlanQueryInput = z.infer<typeof recurringPlanQuerySchema>['query'];
