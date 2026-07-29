import { ExpenseNoteStatus, ExpenseSource } from '@prisma/client';
import { z } from 'zod';

const uuid = z.string().uuid();
const dateInput = z.coerce.date();
const money = z.coerce.number().finite().nonnegative();
const positiveMoney = z.coerce.number().finite().positive();
const rate = z.coerce.number().finite().min(0).max(100);
const reason = z.string().trim().min(3).max(1000);
const optionalNumberString = z.string().trim().refine((value) => value === '' || (Number.isFinite(Number(value)) && Number(value) >= 0), 'Must be a valid non-negative number').optional();
const optionalDateString = z.string().trim().refine((value) => value === '' || !Number.isNaN(new Date(value).getTime()), 'Must be a valid date').optional();

export const expenseIdParamSchema = z.object({ params: z.object({ id: uuid }) });
export const expenseAttachmentParamSchema = z.object({ params: z.object({ attachmentId: uuid }) });
export const expenseEmailLogParamSchema = z.object({ params: z.object({ emailLogId: uuid }) });

export const expenseCategoryBodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  active: z.boolean().optional(),
});

export const expenseTypeBodySchema = z.object({
  categoryId: uuid,
  name: z.string().trim().min(2).max(120),
  active: z.boolean().optional(),
});

export const createExpenseCategorySchema = z.object({ body: expenseCategoryBodySchema });
export const updateExpenseCategorySchema = z.object({ body: expenseCategoryBodySchema.partial() });
export const createExpenseTypeSchema = z.object({ body: expenseTypeBodySchema });
export const updateExpenseTypeSchema = z.object({ body: expenseTypeBodySchema.partial() });

const expenseNoteBodyBaseSchema = z.object({
  categoryId: uuid,
  expenseTypeId: uuid,
  expenseDate: dateInput,
  amountTTC: positiveMoney,
  amountHT: money.optional().nullable(),
  vatAmount: money.default(0),
  vatRate: rate.default(0),
  comment: z.string().trim().max(2000).optional().nullable(),
  merchantName: z.string().trim().max(255).optional().nullable(),
  receiptNumber: z.string().trim().max(255).optional().nullable(),
  currency: z.string().trim().min(3).max(10).default('MAD'),
  source: z.nativeEnum(ExpenseSource).default(ExpenseSource.MANUAL),
  submit: z.boolean().optional(),
  attachmentId: uuid.optional(),
  aiAnalysisId: uuid.optional(),
});

function validateVatAmounts(value: { vatAmount?: number; amountTTC?: number }, ctx: z.RefinementCtx) {
  if (value.vatAmount !== undefined && value.amountTTC !== undefined && value.vatAmount > value.amountTTC) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['vatAmount'],
      message: 'VAT amount cannot exceed total amount',
    });
  }
}

function validateTotalConsistency(value: { amountHT?: number | null; vatAmount?: number; amountTTC?: number }, ctx: z.RefinementCtx) {
  if (value.amountHT === undefined || value.amountHT === null || value.vatAmount === undefined || value.amountTTC === undefined) return;
  const expected = value.amountHT + value.vatAmount;
  if (Math.abs(expected - value.amountTTC) > 0.05) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['amountHT'],
      message: 'Amount excluding VAT plus VAT must be consistent with total amount',
    });
  }
}

export const expenseNoteBodySchema = expenseNoteBodyBaseSchema
  .superRefine(validateVatAmounts)
  .superRefine(validateTotalConsistency);

export const createExpenseNoteSchema = z.object({ body: expenseNoteBodySchema });
export const updateExpenseNoteSchema = z.object({
  body: expenseNoteBodyBaseSchema.partial().superRefine(validateVatAmounts).superRefine(validateTotalConsistency),
});

const expenseNoteQueryObjectSchema = z.object({
  page: z.string().regex(/^\d+$/).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  search: z.string().trim().optional(),
  categoryId: uuid.optional(),
  expenseTypeId: uuid.optional(),
  source: z.nativeEnum(ExpenseSource).optional(),
  status: z.nativeEnum(ExpenseNoteStatus).optional(),
  employeeId: uuid.optional(),
  amountMin: optionalNumberString,
  amountMax: optionalNumberString,
  dateFrom: optionalDateString,
  dateTo: optionalDateString,
  currency: z.string().trim().min(3).max(10).optional(),
  hasReceipt: z.enum(['true', 'false']).optional().transform((value) => value === undefined ? undefined : value === 'true'),
  hasWarnings: z.enum(['true', 'false']).optional().transform((value) => value === undefined ? undefined : value === 'true'),
  aiConfidenceMin: z.string().trim().refine((value) => value === '' || (Number(value) >= 0 && Number(value) <= 100), 'AI confidence must be between 0 and 100').optional(),
});

export const expenseNoteQuerySchema = z.object({
  query: expenseNoteQueryObjectSchema,
}).superRefine(({ query }, ctx) => {
  if (query.amountMin && query.amountMax && Number(query.amountMin) > Number(query.amountMax)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['query', 'amountMin'], message: 'Minimum amount cannot exceed maximum amount' });
  }
  if (query.dateFrom && query.dateTo && new Date(query.dateFrom) > new Date(query.dateTo)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['query', 'dateFrom'], message: 'Start date cannot be after end date' });
  }
});

export const categoryQuerySchema = z.object({
  query: z.object({
    active: z.enum(['true', 'false']).optional().transform((value) => {
      if (value === undefined) return undefined;
      return value === 'true';
    }),
  }),
});

export const typeQuerySchema = z.object({
  query: z.object({
    categoryId: uuid.optional(),
    active: z.enum(['true', 'false']).optional().transform((value) => {
      if (value === undefined) return undefined;
      return value === 'true';
    }),
  }),
});

export const aiExtractionSchema = z.object({
  expenseDate: z.string().min(1),
  amountTTC: positiveMoney,
  amountHT: money.optional().nullable(),
  vatAmount: money.default(0),
  vatRate: rate.default(0),
  categoryId: uuid,
  expenseTypeId: uuid,
  merchantName: z.string().trim().max(255).optional().nullable(),
  documentNumber: z.string().trim().max(255).optional().nullable(),
  currency: z.string().trim().min(3).max(10).default('MAD'),
  comment: z.string().trim().max(2000).optional().nullable(),
  confidence: z.object({
    expenseDate: z.coerce.number().min(0).max(1).optional(),
    amountTTC: z.coerce.number().min(0).max(1).optional(),
    vat: z.coerce.number().min(0).max(1).optional(),
    category: z.coerce.number().min(0).max(1).optional(),
    expenseType: z.coerce.number().min(0).max(1).optional(),
  }).default({}),
  warnings: z.array(z.string().trim().max(500)).default([]),
  evidence: z.record(z.string(), z.string().trim().max(300)).optional().default({}),
}).superRefine((value, ctx) => {
  if (value.vatAmount > value.amountTTC) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['vatAmount'],
      message: 'VAT amount cannot exceed total amount',
    });
  }

  const parsedDate = new Date(value.expenseDate);
  if (Number.isNaN(parsedDate.getTime())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expenseDate'],
      message: 'Invalid expense date',
    });
  }

  if (value.amountHT !== undefined && value.amountHT !== null) {
    validateTotalConsistency(value, ctx);
  }
});

export const expenseReasonSchema = z.object({
  body: z.object({ reason }),
});

export const expenseActionSchema = z.object({
  body: z.object({ reason: reason.optional() }).optional().default({}),
});

export const expensePdfQuerySchema = z.object({
  query: z.object({
    language: z.enum(['en', 'fr', 'ar']).optional().default('fr'),
    disposition: z.enum(['inline', 'attachment']).optional().default('attachment'),
  }),
});

export const sendExpenseEmailSchema = z.object({
  body: z.object({
    to: z.string().email('Invalid email address').optional(),
    cc: z.array(z.string().email('Invalid email address')).max(20).optional().default([]),
    bcc: z.array(z.string().email('Invalid email address')).max(20).optional().default([]),
    subject: z.string().trim().min(3).max(255).optional(),
    message: z.string().trim().min(3).max(5000).optional(),
    pdfLanguage: z.enum(['en', 'fr', 'ar']).optional().default('fr'),
  }),
});

export const expenseBulkExportSchema = z.object({
  body: z.object({
    ids: z.array(uuid).max(250).optional(),
    filters: expenseNoteQueryObjectSchema.omit({ page: true, limit: true }).optional().default({}),
    format: z.enum(['pdf', 'zip', 'excel', 'csv']).default('excel'),
    language: z.enum(['en', 'fr', 'ar']).optional().default('fr'),
    includeReceipts: z.boolean().optional().default(false),
  }).refine((value) => Boolean(value.ids?.length) || Object.keys(value.filters ?? {}).length > 0, {
    message: 'Select expenses or provide filters for export',
    path: ['ids'],
  }),
});

export type CreateExpenseCategoryInput = z.infer<typeof createExpenseCategorySchema>['body'];
export type UpdateExpenseCategoryInput = z.infer<typeof updateExpenseCategorySchema>['body'];
export type CreateExpenseTypeInput = z.infer<typeof createExpenseTypeSchema>['body'];
export type UpdateExpenseTypeInput = z.infer<typeof updateExpenseTypeSchema>['body'];
export type CreateExpenseNoteInput = z.infer<typeof createExpenseNoteSchema>['body'];
export type UpdateExpenseNoteInput = z.infer<typeof updateExpenseNoteSchema>['body'];
export type ExpenseNoteQueryInput = z.infer<typeof expenseNoteQuerySchema>['query'];
export type CategoryQueryInput = z.infer<typeof categoryQuerySchema>['query'];
export type TypeQueryInput = z.infer<typeof typeQuerySchema>['query'];
export type AIExtractionInput = z.infer<typeof aiExtractionSchema>;
export type ExpenseReasonInput = z.infer<typeof expenseReasonSchema>['body'];
export type ExpensePdfQueryInput = z.infer<typeof expensePdfQuerySchema>['query'];
export type SendExpenseEmailInput = z.infer<typeof sendExpenseEmailSchema>['body'];
export type ExpenseBulkExportInput = z.infer<typeof expenseBulkExportSchema>['body'];
