import { CreditNoteStatus, CreditNoteType } from '@prisma/client';
import { z } from 'zod';

const dateString = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Invalid date',
});

const money = z.coerce.number().min(0);

export const creditNoteLineSchema = z.object({
  invoiceItemId: z.string().uuid().optional().nullable(),
  description: z.string().min(2).max(1000),
  unit: z.string().max(50).optional().nullable(),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  taxRate: z.coerce.number().min(0).max(100).optional(),
});

const creditNoteBodySchema = z.object({
  invoiceId: z.string().uuid(),
  type: z.nativeEnum(CreditNoteType).default(CreditNoteType.PARTIAL),
  issueDate: dateString,
  reasonId: z.string().uuid(),
  reason: z.string().trim().max(2000).optional().nullable(),
  internalComment: z.string().max(5000).optional().nullable(),
  lines: z.array(creditNoteLineSchema).optional(),
  amountTTC: z.coerce.number().positive().optional(),
});

const creditNoteBodyWithRules = creditNoteBodySchema.refine((data) => data.type === CreditNoteType.FULL || data.amountTTC || (data.lines?.length ?? 0) > 0, {
    message: 'Partial credit notes require lines or amountTTC',
    path: ['lines'],
});

export const createCreditNoteSchema = z.object({
  body: creditNoteBodyWithRules,
});

export const updateCreditNoteSchema = z.object({
  body: creditNoteBodySchema.omit({ invoiceId: true }).refine((data) => data.type === CreditNoteType.FULL || data.amountTTC || (data.lines?.length ?? 0) > 0, {
    message: 'Partial credit notes require lines or amountTTC',
    path: ['lines'],
  }),
});

export const creditNoteQuerySchema = z.object({
  query: z.object({
    page: z.string().regex(/^\d+$/).optional(),
    limit: z.string().regex(/^\d+$/).optional(),
    search: z.string().optional(),
    status: z.nativeEnum(CreditNoteStatus).optional(),
    invoiceId: z.string().uuid().optional(),
    customerId: z.string().uuid().optional(),
    dateFrom: dateString.optional(),
    dateTo: dateString.optional(),
    sortBy: z.enum(['createdAt', 'issueDate', 'total', 'creditNoteNumber']).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
  }),
});

export const cancelCreditNoteSchema = z.object({
  body: z.object({
    reason: z.string().min(3).max(2000),
  }),
});

export const refundCreditNoteSchema = z.object({
  body: z.object({
    amount: money.positive(),
    refundDate: dateString,
    reference: z.string().max(255).optional().nullable(),
    comment: z.string().max(2000).optional().nullable(),
  }),
});

export const sendCreditNoteEmailSchema = z.object({
  body: z.object({
    recipientEmail: z.string().email('Invalid email address').optional(),
    subject: z.string().min(3).max(255).optional(),
    message: z.string().min(3).max(5000).optional(),
    pdfLanguage: z.enum(['fr', 'en', 'ar']).optional(),
  }),
});

export const creditNoteReasonBodySchema = z.object({
  body: z.object({
    code: z.string().trim().min(2).max(80).regex(/^[A-Z0-9_]+$/),
    nameFr: z.string().trim().min(2).max(255),
    nameEn: z.string().trim().min(2).max(255),
    nameAr: z.string().trim().min(2).max(255),
    description: z.string().trim().max(5000).optional().nullable(),
    category: z.string().trim().min(2).max(80).default('GENERAL'),
    isActive: z.boolean().optional(),
    requiresComment: z.boolean().optional(),
    sortOrder: z.coerce.number().int().min(0).max(10000).optional(),
  }),
});

export const creditNoteReasonUpdateSchema = z.object({
  body: creditNoteReasonBodySchema.shape.body.partial().refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required',
  }),
});

export type CreateCreditNoteInput = z.infer<typeof createCreditNoteSchema>['body'];
export type UpdateCreditNoteInput = z.infer<typeof updateCreditNoteSchema>['body'];
export type CreditNoteQueryInput = z.infer<typeof creditNoteQuerySchema>['query'];
export type CancelCreditNoteInput = z.infer<typeof cancelCreditNoteSchema>['body'];
export type RefundCreditNoteInput = z.infer<typeof refundCreditNoteSchema>['body'];
export type SendCreditNoteEmailInput = z.infer<typeof sendCreditNoteEmailSchema>['body'];
export type CreditNoteReasonInput = z.infer<typeof creditNoteReasonBodySchema>['body'];
export type CreditNoteReasonUpdateInput = z.infer<typeof creditNoteReasonUpdateSchema>['body'];
