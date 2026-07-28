import { DevisStatus } from '@prisma/client';
import { z } from 'zod';

const dateString = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Invalid date',
});

const money = z.coerce.number().min(0);

export const devisItemSchema = z.object({
  description: z.string().min(2).max(1000),
  unit: z.string().max(50).optional().nullable(),
  quantity: z.coerce.number().positive(),
  unitPrice: money,
  discount: money.default(0),
  taxRate: z.coerce.number().min(0).max(100).optional(),
});

export const createDevisSchema = z.object({
  body: z.object({
    customerId: z.string().uuid(),
    status: z.nativeEnum(DevisStatus).optional(),
    issueDate: dateString,
    validUntil: dateString,
    taxRate: z.coerce.number().min(0).max(100).optional(),
    vatOverrideReason: z.string().max(500).optional().nullable(),
    discount: money.default(0),
    notes: z.string().optional().nullable(),
    terms: z.string().optional().nullable(),
    currency: z.string().min(3).max(10).default('MAD'),
    items: z.array(devisItemSchema).min(1, 'At least one quote item is required'),
  }),
});

export const updateDevisSchema = z.object({
  body: createDevisSchema.shape.body.omit({ status: true }),
});

export const updateDevisStatusSchema = z.object({
  body: z.object({
    status: z.nativeEnum(DevisStatus),
  }),
});

export const devisQuerySchema = z.object({
  query: z.object({
    page: z.string().regex(/^\d+$/).optional(),
    limit: z.string().regex(/^\d+$/).optional(),
    search: z.string().optional(),
    status: z.nativeEnum(DevisStatus).optional(),
    customerId: z.string().uuid().optional(),
    dateFrom: dateString.optional(),
    dateTo: dateString.optional(),
    sortBy: z.enum(['createdAt', 'issueDate', 'validUntil', 'total', 'devisNumber']).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
  }),
});

export type CreateDevisInput = z.infer<typeof createDevisSchema>['body'];
export type UpdateDevisInput = z.infer<typeof updateDevisSchema>['body'];
export type DevisQueryInput = z.infer<typeof devisQuerySchema>['query'];
