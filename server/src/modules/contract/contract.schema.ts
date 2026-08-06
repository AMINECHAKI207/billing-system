import { ContractBillingFrequency, ContractPricingType, ContractProrationPolicy, ContractRenewalType, ContractStatus, ContractTimeEntryStatus, ContractMilestoneStatus, ContractBillingScheduleStatus } from '@prisma/client';
import { z } from 'zod';

const dateString = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Invalid date',
});

const optionalDateString = z.preprocess((value) => (value === '' || value === null ? undefined : value), dateString.optional());
const optionalMoney = z.preprocess((value) => (value === '' || value === null ? undefined : value), z.coerce.number().min(0).optional());
const optionalPositiveMoney = z.preprocess((value) => (value === '' || value === null ? undefined : value), z.coerce.number().positive().optional());
const optionalQuantity = z.preprocess((value) => (value === '' || value === null ? undefined : value), z.coerce.number().min(0).optional());

const contractBodyObject = z.object({
  clientId: z.string().uuid(),
  templateId: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(2).max(255),
  contractType: z.string().trim().min(2).max(80).default('GENERAL'),
  language: z.enum(['fr', 'en', 'ar']).default('fr'),
  startDate: optionalDateString,
  endDate: optionalDateString,
  renewalType: z.nativeEnum(ContractRenewalType).default(ContractRenewalType.NONE),
  renewalNoticeDays: z.coerce.number().int().min(0).max(365).optional().nullable(),
  amount: optionalMoney,
  currency: z.string().trim().min(3).max(10).default('MAD'),
  pricingType: z.nativeEnum(ContractPricingType).default(ContractPricingType.FIXED),
  unitRate: optionalPositiveMoney,
  estimatedQuantity: optionalQuantity,
  fixedAmount: optionalPositiveMoney,
  billingFrequency: z.nativeEnum(ContractBillingFrequency).default(ContractBillingFrequency.ONE_TIME),
  billingDay: z.coerce.number().int().min(1).max(31).optional().nullable(),
  billingStartDate: optionalDateString,
  billingEndDate: optionalDateString,
  minimumBillableUnits: optionalQuantity,
  includedUnits: optionalQuantity,
  overtimeRate: optionalMoney,
  taxRate: z.coerce.number().min(0).max(100).default(0),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(30),
  autoInvoiceEnabled: z.coerce.boolean().default(false),
  nextInvoiceDate: optionalDateString,
  lastInvoiceDate: optionalDateString,
  prorationPolicy: z.nativeEnum(ContractProrationPolicy).default(ContractProrationPolicy.NONE),
  billingDescription: z.string().trim().max(5000).optional().nullable(),
  summary: z.string().trim().max(2000).optional().nullable(),
  terms: z.string().trim().max(20000).optional().nullable(),
  content: z.string().trim().min(20).max(50000).optional(),
});

export const contractBodySchema = contractBodyObject.superRefine((value, ctx) => {
  validatePricingFields(value, ctx);
});

export const createContractSchema = z.object({
  body: contractBodySchema,
});

export const updateContractSchema = z.object({
  body: contractBodyObject.omit({ clientId: true }).partial().superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'At least one field is required' });
      return;
    }
    validatePricingFields(value, ctx);
  }),
});

export const contractQuerySchema = z.object({
  query: z.object({
    page: z.string().regex(/^\d+$/).optional(),
    limit: z.string().regex(/^\d+$/).optional(),
    search: z.string().trim().optional(),
    status: z.nativeEnum(ContractStatus).refine((status) => status !== ContractStatus.SIGNED, {
      message: 'SIGNED is not a contract business status',
    }).optional(),
    clientId: z.string().uuid().optional(),
    dateFrom: dateString.optional(),
    dateTo: dateString.optional(),
    sortBy: z.enum(['createdAt', 'contractNumber', 'title', 'startDate', 'endDate', 'status']).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
  }),
});

export const contractStatusSchema = z.object({
  body: z.object({
    status: z.nativeEnum(ContractStatus).refine((status) => status !== ContractStatus.SIGNED, {
      message: 'Contract cannot be marked as signed directly',
    }),
  }),
});

export const contractSignatureRevokeSchema = z.object({
  body: z.object({
    reason: z.string().trim().min(3).max(1000),
    internalNote: z.string().trim().max(2000).optional().nullable(),
    confirmed: z.literal(true),
  }),
});

export const contractEmailSchema = z.object({
  body: z.object({
    to: z.string().email(),
    cc: z.array(z.string().email()).optional(),
    bcc: z.array(z.string().email()).optional(),
    subject: z.string().trim().min(2).max(255).optional(),
    message: z.string().trim().min(2).max(5000).optional(),
    pdfLanguage: z.enum(['fr', 'en', 'ar']).default('fr'),
    signatureLinkExpiresInDays: z.coerce.number().int().min(1).max(30).default(7),
  }),
});

export const publicSignatureSchema = z.object({
  body: z.object({
    signerName: z.string().trim().min(2).max(255),
    signerEmail: z.string().email(),
    accepted: z.literal(true),
  }),
});

export const contractTimeEntryBodySchema = z.object({
  contractId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  workDate: dateString,
  startTime: z.string().datetime().optional().nullable(),
  endTime: z.string().datetime().optional().nullable(),
  breakMinutes: z.coerce.number().int().min(0).max(1440).default(0),
  quantity: z.coerce.number().positive().optional(),
  activityType: z.string().trim().min(2).max(80).optional().nullable(),
  description: z.string().trim().min(2).max(2000),
  internalNote: z.string().trim().max(2000).optional().nullable(),
  billable: z.coerce.boolean().default(true),
  submit: z.coerce.boolean().default(false),
}).superRefine((value, ctx) => {
  if (value.startTime || value.endTime) {
    if (!value.startTime) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['startTime'], message: 'Start time is required when end time is provided' });
    }
    if (!value.endTime) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endTime'], message: 'End time is required when start time is provided' });
    }
  }
  if (value.startTime && value.endTime && new Date(value.endTime) <= new Date(value.startTime)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endTime'], message: 'End time must be after start time' });
  }
  if (!value.quantity && !(value.startTime && value.endTime)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['quantity'], message: 'Quantity or start/end time is required' });
  }
});

export const contractTimeEntryUpdateSchema = z.object({
  workDate: dateString.optional(),
  startTime: z.string().datetime().optional().nullable(),
  endTime: z.string().datetime().optional().nullable(),
  breakMinutes: z.coerce.number().int().min(0).max(1440).optional(),
  quantity: z.coerce.number().positive().optional(),
  activityType: z.string().trim().min(2).max(80).optional().nullable(),
  description: z.string().trim().min(2).max(2000).optional(),
  internalNote: z.string().trim().max(2000).optional().nullable(),
  billable: z.coerce.boolean().optional(),
}).superRefine((value, ctx) => {
  if ((value.startTime && !value.endTime) || (!value.startTime && value.endTime)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endTime'], message: 'Start and end time must be provided together' });
  }
  if (value.startTime && value.endTime && new Date(value.endTime) <= new Date(value.startTime)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endTime'], message: 'End time must be after start time' });
  }
});

export const contractTimeEntryRejectSchema = z.object({
  reason: z.string().trim().min(3).max(2000),
});

export const contractMilestoneBodySchema = z.object({
  title: z.string().trim().min(2).max(255),
  description: z.string().trim().max(2000).optional().nullable(),
  dueDate: optionalDateString,
  amount: optionalPositiveMoney,
  percentage: z.coerce.number().min(0).max(100).optional().nullable(),
  status: z.nativeEnum(ContractMilestoneStatus).optional(),
  sortOrder: z.coerce.number().int().min(0).default(0),
}).refine((value) => value.amount != null || value.percentage != null, {
  message: 'Milestone amount or percentage is required',
  path: ['amount'],
});

export const contractBillingScheduleItemBodySchema = z.object({
  label: z.string().trim().min(2).max(255),
  dueDate: dateString,
  amount: z.coerce.number().positive(),
  status: z.nativeEnum(ContractBillingScheduleStatus).optional(),
  sortOrder: z.coerce.number().int().min(0).default(0),
});

export const contractBillingActionSchema = z.object({
  body: z.object({
    periodStart: optionalDateString,
    periodEnd: optionalDateString,
    milestoneId: z.string().uuid().optional(),
    scheduleItemId: z.string().uuid().optional(),
  }).optional().default({}),
});

function validatePricingFields(value: Partial<z.infer<typeof contractBodyObject>>, ctx: z.RefinementCtx) {
  const requireField = (field: keyof typeof value, message: string) => {
    if (value[field] === undefined || value[field] === null || value[field] === '') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });
    }
  };

  if (value.billingStartDate && value.billingEndDate && new Date(value.billingEndDate) < new Date(value.billingStartDate)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['billingEndDate'], message: 'Billing end date must be after billing start date' });
  }

  if (value.nextInvoiceDate && !value.autoInvoiceEnabled) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nextInvoiceDate'], message: 'Next invoice date requires automatic invoicing' });
  }

  switch (value.pricingType) {
    case ContractPricingType.FIXED:
      requireField('fixedAmount', 'Fixed amount is required');
      break;
    case ContractPricingType.HOURLY:
    case ContractPricingType.DAILY:
      requireField('unitRate', 'Unit rate is required');
      if (value.billingFrequency === ContractBillingFrequency.ONE_TIME) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['billingFrequency'], message: 'A recurring billing frequency is required' });
      }
      break;
    case ContractPricingType.MONTHLY:
      requireField('unitRate', 'Monthly amount is required');
      break;
    case ContractPricingType.MONTHLY_SUBSCRIPTION:
      requireField('unitRate', 'Monthly subscription amount is required');
      requireField('billingStartDate', 'Billing start date is required');
      if (value.billingFrequency !== ContractBillingFrequency.MONTHLY) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['billingFrequency'], message: 'Monthly subscriptions must use monthly billing' });
      }
      break;
    case ContractPricingType.ANNUAL_SUBSCRIPTION:
      requireField('unitRate', 'Annual subscription amount is required');
      requireField('billingStartDate', 'Billing start date is required');
      if (value.billingFrequency !== ContractBillingFrequency.ANNUAL) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['billingFrequency'], message: 'Annual subscriptions must use annual billing' });
      }
      break;
    case ContractPricingType.CUSTOM:
      requireField('billingDescription', 'Custom billing description is required');
      break;
    case ContractPricingType.MILESTONE:
      break;
  }
}

export const templateQuerySchema = z.object({
  query: z.object({
    includeInactive: z.coerce.boolean().optional(),
  }),
});

type ContractBodyOutput = z.infer<typeof contractBodyObject>;
type ContractDefaultedPricingFields = 'pricingType' | 'billingFrequency' | 'taxRate' | 'paymentTermsDays' | 'autoInvoiceEnabled' | 'prorationPolicy';

export type CreateContractInput = Omit<ContractBodyOutput, ContractDefaultedPricingFields> & Partial<Pick<ContractBodyOutput, ContractDefaultedPricingFields>>;
export type UpdateContractInput = Partial<Omit<z.infer<typeof contractBodyObject>, 'clientId'>>;
export type ContractQueryInput = z.infer<typeof contractQuerySchema>['query'];
export type ContractEmailInput = z.infer<typeof contractEmailSchema>['body'];
export type ContractSignatureRevokeInput = z.infer<typeof contractSignatureRevokeSchema>['body'];
export type PublicSignatureInput = z.infer<typeof publicSignatureSchema>['body'];
export type ContractTimeEntryInput = Omit<z.infer<typeof contractTimeEntryBodySchema>, 'breakMinutes' | 'billable' | 'submit'> & {
  breakMinutes?: number;
  billable?: boolean;
  submit?: boolean;
};
export type ContractTimeEntryUpdateInput = z.infer<typeof contractTimeEntryUpdateSchema>;
export type ContractTimeEntryRejectInput = z.infer<typeof contractTimeEntryRejectSchema>;
export type ContractMilestoneInput = z.infer<typeof contractMilestoneBodySchema>;
export type ContractBillingScheduleItemInput = z.infer<typeof contractBillingScheduleItemBodySchema>;
export type ContractBillingActionInput = z.infer<typeof contractBillingActionSchema>['body'];
