import { InvoiceStatus, PaymentMethod } from '@prisma/client';
import { z } from 'zod';

const dateString = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Invalid date',
});

const money = z.coerce.number().min(0);

export const invoiceItemSchema = z.object({
  description: z.string().min(2).max(1000),
  unit: z.string().max(50).optional().nullable(),
  quantity: z.coerce.number().positive(),
  unitPrice: money,
  taxRate: z.coerce.number().min(0).max(100).optional(),
});

export const createInvoiceSchema = z.object({
  body: z.object({
    customerId: z.string().uuid(),
    status: z.nativeEnum(InvoiceStatus).optional(),
    issueDate: dateString,
    dueDate: dateString,
    taxRate: z.coerce.number().min(0).max(100).optional(),
    vatOverrideReason: z.string().max(500).optional().nullable(),
    discount: money.default(0),
    notes: z.string().optional().nullable(),
    terms: z.string().optional().nullable(),
    currency: z.string().min(3).max(10).default('MAD'),
    items: z.array(invoiceItemSchema).min(1, 'At least one invoice item is required'),
  }),
});

export const updateInvoiceSchema = z.object({
  body: createInvoiceSchema.shape.body.omit({ status: true }),
});

export const updateInvoiceStatusSchema = z.object({
  body: z.object({
    status: z.nativeEnum(InvoiceStatus),
  }),
});

export const invoiceQuerySchema = z.object({
  query: z.object({
    page: z.string().regex(/^\d+$/).optional(),
    limit: z.string().regex(/^\d+$/).optional(),
    search: z.string().optional(),
    status: z.nativeEnum(InvoiceStatus).optional(),
    customerId: z.string().uuid().optional(),
    dateFrom: dateString.optional(),
    dateTo: dateString.optional(),
    sortBy: z
      .enum(['createdAt', 'issueDate', 'dueDate', 'total', 'balanceDue', 'invoiceNumber'])
      .optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
  }),
});

export const dashboardQuerySchema = z.object({
  query: z.object({
    period: z.enum(['this_month', 'last_3_months', 'last_6_months', 'this_year', 'custom']).optional(),
    dateFrom: dateString.optional(),
    dateTo: dateString.optional(),
    months: z.string().regex(/^(6|12)$/).optional(),
  }),
});

export const addPaymentSchema = z.object({
  body: z.object({
    amount: z.coerce.number().positive(),
    paymentDate: dateString,
    method: z.nativeEnum(PaymentMethod),
    reference: z.string().max(255).optional().nullable(),
    notes: z.string().optional().nullable(),
  }),
});

export const sendInvoiceEmailSchema = z.object({
  body: z.object({
    recipientEmail: z.string().email('Invalid email address').optional(),
    subject: z.string().min(3).max(255).optional(),
    message: z.string().min(3).max(5000).optional(),
  }),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>['body'];
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>['body'];
export type InvoiceQueryInput = z.infer<typeof invoiceQuerySchema>['query'];
export type DashboardQueryInput = z.infer<typeof dashboardQuerySchema>['query'];
export type AddPaymentInput = z.infer<typeof addPaymentSchema>['body'];
export type SendInvoiceEmailInput = z.infer<typeof sendInvoiceEmailSchema>['body'];
