import {
  AiToolRiskLevel,
  ContractBillingFrequency,
  ContractPricingType,
  ContractProrationPolicy,
  ContractRenewalType,
  ContractStatus,
  CreditNoteStatus,
  DevisStatus,
  ExpenseNoteStatus,
  ExpenseSource,
  InvoiceStatus,
  PaymentMethod,
  PermissionScope,
  RecurringFrequency,
  RecurringPlanStatus,
  ReminderStatus,
  ReminderType,
  Role,
} from '@prisma/client';
import { z } from 'zod';
import { authorizePermission, permissionScope } from '@modules/rbac/accessScope';
import { auditService } from '@modules/audit/audit.service';
import { contractService } from '@modules/contract/contract.service';
import { creditNoteService } from '@modules/credit-note/creditNote.service';
import { customerService } from '@modules/customer/customer.service';
import { devisService } from '@modules/devis/devis.service';
import { expenseService } from '@modules/expense/expense.service';
import { invoiceService } from '@modules/invoice/invoice.service';
import { paymentService } from '@modules/payment/payment.service';
import { productService } from '@modules/product/product.service';
import { rbacService } from '@modules/rbac/rbac.service';
import { recurringService } from '@modules/recurring/recurring.service';
import { reminderService } from '@modules/reminder/reminder.service';
import { reportService } from '@modules/report/report.service';
import { settingsService } from '@modules/settings/settings.service';
import { userService } from '@modules/user/user.service';
import { ApiError } from '@utils/ApiError';
import { AI_ASSISTANT_PERMISSIONS } from '../aiAssistant.permissions';
import type { AiLocalizedText, AiTool, ToolContext, ToolPreview } from './toolTypes';

const uuid = z.string().uuid();
const limit = z.coerce.number().int().min(1).max(50).default(10);
const optionalPage = z.coerce.number().int().min(1).default(1).transform(String);
const optionalLimit = limit.transform(String);
const dateString = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date');
const optionalDate = z.preprocess((value) => (value === '' || value === null ? undefined : value), dateString.optional());
const money = z.coerce.number().min(0);
const optionalMoney = z.preprocess((value) => (value === '' || value === null ? undefined : value), money.optional());
const positiveMoney = z.coerce.number().positive();
const optionalPositiveMoney = z.preprocess((value) => {
  if (value === '' || value === null || value === undefined) return undefined;
  const numeric = typeof value === 'number' ? value : (typeof value === 'string' ? Number(value) : value);
  if (typeof numeric === 'number' && Number.isFinite(numeric) && numeric === 0) return undefined;
  return value;
}, positiveMoney.optional());
const currency = z.string().trim().min(3).max(10).default('MAD');

const searchListInput = z.object({
  search: z.string().trim().max(200).optional(),
  page: optionalPage.optional(),
  limit: optionalLimit.optional(),
}).strict();

const entityIdInput = z.object({ id: uuid }).strict();

const customerInput = z.object({
  name: z.string().trim().min(2).max(255),
  email: z.string().email(),
  phone: z.string().trim().max(50).optional().nullable(),
  company: z.string().trim().max(255).optional().nullable(),
  address: z.string().trim().max(2000).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  country: z.string().trim().min(1).max(100),
  countryCode: z.string().trim().length(2),
  postalCode: z.string().trim().max(50).optional().nullable(),
  taxNumber: z.string().trim().max(100).optional().nullable(),
}).strict();

const customerUpdateInput = customerInput.partial().extend({
  id: uuid,
  isActive: z.boolean().optional(),
}).strict();

const contractCreateInput = z.object({
  clientId: uuid,
  templateId: uuid.optional().nullable(),
  title: z.string().trim().min(2).max(255),
  contractType: z.string().trim().min(2).max(80).default('GENERAL'),
  language: z.enum(['fr', 'en', 'ar']).default('fr'),
  startDate: optionalDate,
  endDate: optionalDate,
  renewalType: z.nativeEnum(ContractRenewalType).default(ContractRenewalType.NONE),
  renewalNoticeDays: z.coerce.number().int().min(0).max(365).optional().nullable(),
  amount: optionalMoney,
  currency,
  pricingType: z.nativeEnum(ContractPricingType).default(ContractPricingType.FIXED),
  unitRate: optionalPositiveMoney,
  estimatedQuantity: optionalMoney,
  fixedAmount: optionalPositiveMoney,
  billingFrequency: z.nativeEnum(ContractBillingFrequency).default(ContractBillingFrequency.ONE_TIME),
  billingDay: z.coerce.number().int().min(1).max(31).optional().nullable(),
  billingStartDate: optionalDate,
  billingEndDate: optionalDate,
  minimumBillableUnits: optionalMoney,
  includedUnits: optionalMoney,
  overtimeRate: optionalMoney,
  taxRate: z.coerce.number().min(0).max(100).default(0),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(30),
  autoInvoiceEnabled: z.boolean().default(false),
  nextInvoiceDate: optionalDate,
  lastInvoiceDate: optionalDate,
  prorationPolicy: z.nativeEnum(ContractProrationPolicy).default(ContractProrationPolicy.NONE),
  billingDescription: z.string().trim().max(5000).optional().nullable(),
  summary: z.string().trim().max(2000).optional().nullable(),
  terms: z.string().trim().max(20000).optional().nullable(),
  content: z.string().trim().min(20).max(50000).optional(),
}).strict();
const contractUpdateInput = contractCreateInput.omit({ clientId: true }).partial().extend({ id: uuid }).strict();
const contractStatusInput = z.object({ id: uuid, status: z.nativeEnum(ContractStatus) }).strict();
const contractEmailInput = z.object({
  id: uuid,
  to: z.string().email(),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  subject: z.string().trim().min(2).max(255).optional(),
  message: z.string().trim().min(2).max(5000).optional(),
  pdfLanguage: z.enum(['fr', 'en', 'ar']).default('fr'),
  signatureLinkExpiresInDays: z.coerce.number().int().min(1).max(30).default(7),
}).strict();
const contractRevokeSignatureInput = z.object({
  id: uuid,
  reason: z.string().trim().min(3).max(1000),
  internalNote: z.string().trim().max(2000).optional().nullable(),
  confirmed: z.literal(true).default(true),
}).strict();

const invoiceItemInput = z.object({
  description: z.string().trim().min(2).max(1000),
  unit: z.string().trim().max(50).optional().nullable(),
  quantity: z.coerce.number().positive(),
  unitPrice: money,
  taxRate: z.coerce.number().min(0).max(100).optional(),
}).strict();

const invoiceCreateInput = z.object({
  customerId: uuid,
  status: z.nativeEnum(InvoiceStatus).optional(),
  issueDate: dateString,
  dueDate: dateString,
  taxRate: z.coerce.number().min(0).max(100).optional(),
  vatOverrideReason: z.string().trim().max(500).optional().nullable(),
  discount: money.default(0),
  notes: z.string().trim().max(5000).optional().nullable(),
  terms: z.string().trim().max(5000).optional().nullable(),
  currency,
  items: z.array(invoiceItemInput).min(1),
}).strict();

const invoiceUpdateInput = invoiceCreateInput.omit({ status: true }).extend({ id: uuid }).strict();
const invoiceStatusInput = z.object({ id: uuid, status: z.nativeEnum(InvoiceStatus) }).strict();
const invoicePaymentInput = z.object({
  invoiceId: uuid,
  amount: positiveMoney,
  paymentDate: dateString,
  method: z.nativeEnum(PaymentMethod),
  reference: z.string().trim().max(255).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
}).strict();

const quoteItemInput = invoiceItemInput.extend({
  discount: money.default(0),
}).strict();
const quoteCreateInput = z.object({
  customerId: uuid,
  status: z.nativeEnum(DevisStatus).optional(),
  issueDate: dateString,
  validUntil: dateString,
  taxRate: z.coerce.number().min(0).max(100).optional(),
  vatOverrideReason: z.string().trim().max(500).optional().nullable(),
  discount: money.default(0),
  notes: z.string().trim().max(5000).optional().nullable(),
  terms: z.string().trim().max(5000).optional().nullable(),
  currency,
  items: z.array(quoteItemInput).min(1),
}).strict();
const quoteUpdateInput = quoteCreateInput.omit({ status: true }).extend({ id: uuid }).strict();
const quoteStatusInput = z.object({ id: uuid, status: z.nativeEnum(DevisStatus) }).strict();
const quoteEmailInput = z.object({
  id: uuid,
  recipientEmail: z.string().email().optional(),
  subject: z.string().trim().min(3).max(255).optional(),
  message: z.string().trim().min(3).max(5000).optional(),
  pdfLanguage: z.enum(['fr', 'en', 'ar']).optional(),
}).strict();

const creditNoteCreateInput = z.object({
  invoiceId: uuid,
  type: z.enum(['FULL', 'PARTIAL']).default('PARTIAL'),
  issueDate: dateString,
  reasonId: uuid,
  reason: z.string().trim().max(2000).optional().nullable(),
  internalComment: z.string().trim().max(5000).optional().nullable(),
  amountTTC: positiveMoney.optional(),
  lines: z.array(z.object({
    invoiceItemId: uuid.optional().nullable(),
    description: z.string().trim().min(2).max(1000),
    unit: z.string().trim().max(50).optional().nullable(),
    quantity: z.coerce.number().positive(),
    unitPrice: money,
    taxRate: z.coerce.number().min(0).max(100).optional(),
  }).strict()).optional(),
}).strict();
const creditNoteUpdateInput = creditNoteCreateInput.omit({ invoiceId: true }).extend({ id: uuid }).strict();
const creditNoteCancelInput = z.object({ id: uuid, reason: z.string().trim().min(3).max(2000) }).strict();
const creditNoteRefundInput = z.object({
  id: uuid,
  amount: positiveMoney,
  refundDate: dateString,
  reference: z.string().trim().max(255).optional().nullable(),
  comment: z.string().trim().max(2000).optional().nullable(),
}).strict();
const creditNoteEmailInput = z.object({
  id: uuid,
  recipientEmail: z.string().email().optional(),
  subject: z.string().trim().min(3).max(255).optional(),
  message: z.string().trim().min(3).max(5000).optional(),
  pdfLanguage: z.enum(['fr', 'en', 'ar']).optional(),
}).strict();

const expenseCreateInput = z.object({
  categoryId: uuid,
  expenseTypeId: uuid,
  expenseDate: z.coerce.date(),
  amountTTC: positiveMoney,
  amountHT: money.optional().nullable(),
  vatAmount: money.default(0),
  vatRate: z.coerce.number().min(0).max(100).default(0),
  comment: z.string().trim().max(2000).optional().nullable(),
  merchantName: z.string().trim().max(255).optional().nullable(),
  receiptNumber: z.string().trim().max(255).optional().nullable(),
  currency,
  source: z.nativeEnum(ExpenseSource).default(ExpenseSource.MANUAL),
  submit: z.boolean().optional(),
  attachmentId: uuid.optional(),
  aiAnalysisId: uuid.optional(),
}).strict();
const expenseUpdateInput = expenseCreateInput.partial().extend({ id: uuid }).strict();
const expenseRejectInput = z.object({ id: uuid, reason: z.string().trim().min(3).max(1000) }).strict();
const expenseEmailInput = z.object({
  id: uuid,
  to: z.string().email().optional(),
  cc: z.array(z.string().email()).max(20).optional().default([]),
  bcc: z.array(z.string().email()).max(20).optional().default([]),
  subject: z.string().trim().min(3).max(255).optional(),
  message: z.string().trim().min(3).max(5000).optional(),
  pdfLanguage: z.enum(['en', 'fr', 'ar']).optional().default('fr'),
}).strict();

const productInput = z.object({
  name: z.string().trim().min(2).max(255),
  description: z.string().trim().max(5000).optional().nullable(),
  unit: z.string().trim().max(50).optional().nullable(),
  unitPrice: money,
  taxRate: z.coerce.number().min(0).max(100).default(20),
  isActive: z.boolean().optional(),
}).strict();
const productUpdateInput = productInput.partial().extend({ id: uuid }).strict();

const recurringItemInput = z.object({
  description: z.string().trim().min(2).max(1000),
  unit: z.string().trim().max(50).optional().nullable(),
  quantity: z.coerce.number().positive(),
  unitPrice: money,
  taxRate: z.coerce.number().min(0).max(100).default(0),
}).strict();
const recurringCreateInput = z.object({
  customerId: uuid,
  name: z.string().trim().min(2).max(255),
  frequency: z.nativeEnum(RecurringFrequency),
  intervalCount: z.coerce.number().int().min(1).max(24).default(1),
  startDate: dateString,
  endDate: optionalDate.nullable(),
  dueDays: z.coerce.number().int().min(0).max(365).default(30),
  autoSend: z.boolean().default(false),
  currency,
  discount: money.default(0),
  notes: z.string().trim().max(5000).optional().nullable(),
  terms: z.string().trim().max(5000).optional().nullable(),
  items: z.array(recurringItemInput).min(1),
}).strict();
const recurringUpdateInput = recurringCreateInput.partial().extend({ id: uuid }).strict();
const recurringQueryInput = searchListInput.extend({
  status: z.nativeEnum(RecurringPlanStatus).optional(),
  customerId: uuid.optional(),
}).strict();
const recurringStatusInput = z.object({
  id: uuid,
  status: z.enum(['ACTIVE', 'PAUSED', 'CANCELLED']),
}).strict();

const reminderQueryInput = searchListInput.extend({
  invoiceId: uuid.optional(),
  status: z.nativeEnum(ReminderStatus).optional(),
  type: z.nativeEnum(ReminderType).optional(),
}).strict();
const reminderCreateInput = z.object({
  invoiceId: uuid,
  type: z.nativeEnum(ReminderType).default(ReminderType.MANUAL),
  recipientEmail: z.string().email().optional(),
  subject: z.string().trim().min(3).max(255).optional(),
  body: z.string().trim().min(10).max(10000).optional(),
  sendEmail: z.boolean().default(true),
}).strict();

const expenseCategoryInput = z.object({
  name: z.string().trim().min(2).max(120),
  active: z.boolean().optional(),
}).strict();
const expenseCategoryUpdateInput = expenseCategoryInput.partial().extend({ id: uuid }).strict();
const expenseTypeInput = z.object({
  categoryId: uuid,
  name: z.string().trim().min(2).max(120),
  active: z.boolean().optional(),
}).strict();
const expenseTypeUpdateInput = expenseTypeInput.partial().extend({ id: uuid }).strict();
const expenseExportInput = z.object({
  ids: z.array(uuid).max(250).optional(),
  filters: z.object({
    search: z.string().trim().optional(),
    categoryId: uuid.optional(),
    expenseTypeId: uuid.optional(),
    source: z.nativeEnum(ExpenseSource).optional(),
    status: z.nativeEnum(ExpenseNoteStatus).optional(),
    employeeId: uuid.optional(),
    amountMin: z.coerce.number().min(0).optional(),
    amountMax: z.coerce.number().min(0).optional(),
    dateFrom: optionalDate,
    dateTo: optionalDate,
    currency: z.string().trim().min(3).max(10).optional(),
    hasReceipt: z.boolean().optional(),
    hasWarnings: z.boolean().optional(),
    aiConfidenceMin: z.coerce.number().min(0).max(100).optional(),
  }).strict().optional().default({}),
  format: z.enum(['pdf', 'zip', 'excel', 'csv']).default('excel'),
  language: z.enum(['en', 'fr', 'ar']).optional().default('fr'),
  includeReceipts: z.boolean().optional().default(false),
}).strict().superRefine((value, ctx) => {
  if ((!value.ids || value.ids.length === 0) && Object.keys(value.filters ?? {}).length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ids'],
      message: 'Select expenses or provide filters for export',
    });
  }
});
const expenseEmailLogInput = z.object({ emailLogId: uuid }).strict();
const expenseAttachmentInput = z.object({ attachmentId: uuid }).strict();

const settingsAssetKind = z.enum(['signature', 'stamp']);
const settingsAssetInput = z.object({ kind: settingsAssetKind }).strict();
const permissionCreateInput = z.object({
  key: z.string().trim().min(3).max(255),
  description: z.string().trim().max(1000).optional().nullable(),
}).strict();

const roleInput = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional().nullable(),
}).strict();
const roleUpdateInput = roleInput.partial().extend({ id: uuid }).strict();
const assignRoleInput = z.object({ userId: uuid, roleId: uuid }).strict();
const assignClientsInput = z.object({ userId: uuid, clientIds: z.array(uuid).max(500) }).strict();
const assignPermissionsInput = z.object({
  roleId: uuid,
  permissions: z.array(z.object({
    permissionId: uuid,
    scope: z.nativeEnum(PermissionScope),
  }).strict()).max(500),
}).strict();

const userCreateInput = z.object({
  name: z.string().trim().min(2).max(255),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  role: z.nativeEnum(Role).default(Role.EMPLOYEE),
  isActive: z.boolean().optional(),
}).strict();
const userUpdateInput = userCreateInput.partial().extend({ id: uuid }).strict();

const settingsInput = z.object({
  name: z.string().trim().min(2).max(255),
  address: z.string().trim().optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
  email: z.string().email().optional().nullable(),
  taxNumber: z.string().trim().max(100).optional().nullable(),
  logoUrl: z.string().url().optional().nullable(),
  signatureUrl: z.string().trim().optional().nullable(),
  stampUrl: z.string().trim().optional().nullable(),
  defaultCurrency: z.string().trim().min(3).max(10),
  defaultTaxRate: z.coerce.number().min(0).max(100),
  vatEnabled: z.boolean().default(true),
  moroccoVatRate: z.coerce.number().min(0).max(100).default(20),
  paymentTerms: z.string().trim().optional().nullable(),
  bankDetails: z.string().trim().optional().nullable(),
}).strict();

const auditListInput = z.object({
  page: optionalPage.optional(),
  limit: optionalLimit.optional(),
  search: z.string().trim().max(200).optional(),
  module: z.string().trim().max(80).optional(),
  entity: z.string().trim().max(120).optional(),
  action: z.string().trim().max(80).optional(),
  success: z.enum(['true', 'false']).optional(),
  dateFrom: optionalDate,
  dateTo: optionalDate,
}).strict();
const auditTimelineInput = z.object({
  entity: z.string().trim().min(2).max(120),
  entityId: uuid,
  page: z.coerce.number().int().min(1).default(1),
  limit,
}).strict();

function erpScope(context: ToolContext, permission: string, assistantPermission: string = AI_ASSISTANT_PERMISSIONS.useReadTools) {
  if (!context.user.permissions.includes(assistantPermission)) {
    throw ApiError.forbidden('You are not allowed to use this assistant action.');
  }
  const authorization = authorizePermission({
    userId: context.user.id,
    permissions: context.user.permissions,
    scopes: context.user.permissionScopes,
    permission,
  });
  if (!authorization.allowed) throw ApiError.forbidden(`Missing permission: ${permission}`);
  return permissionScope(context.user.permissionScopes, permission);
}

const INTERNAL_ID_SUFFIX = /[a-z0-9]Id$/;
const SENSITIVE_FIELD_KEYWORDS = /(hash|token|secret|password|cookie|authorization)/i;

function isInternalPreviewField(key: string): boolean {
  if (key.toLowerCase() === 'id') return true;
  if (INTERNAL_ID_SUFFIX.test(key)) return true;
  return SENSITIVE_FIELD_KEYWORDS.test(key);
}

function sanitizePreviewSummary(summary: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(summary)) {
    if (isInternalPreviewField(key)) continue;
    sanitized[key] = value;
  }
  return sanitized;
}

function preview(title: string, description: string, summary: Record<string, unknown>): ToolPreview {
  return { title, description, summary: sanitizePreviewSummary(summary) };
}

function text(fr: string, en: string, ar: string): AiLocalizedText {
  return { fr, en, ar };
}

function option(value: string, fr: string, en: string, ar: string) {
  return { value, label: text(fr, en, ar) };
}

async function resolveCustomerDisplayValue(value: unknown, draft: Record<string, unknown>, context: ToolContext) {
  if (typeof draft.customerName === 'string' && draft.customerName.trim()) return draft.customerName.trim();
  if (typeof draft.clientName === 'string' && draft.clientName.trim()) return draft.clientName.trim();
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const customer = await customerService.getCustomerById(value, context.user.id, permissionScope(context.user.permissionScopes, 'clients.view'));
    return customer.company || customer.name || value;
  } catch {
    return value;
  }
}

async function resolveContractCustomerDisplayValue(value: unknown, _draft: Record<string, unknown>, context: ToolContext) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const customer = await customerService.getCustomerById(value, context.user.id, permissionScope(context.user.permissionScopes, 'clients.view'));
    return customer.company || customer.name || value;
  } catch {
    return value;
  }
}

async function resolveInvoiceDisplayValue(value: unknown, _draft: Record<string, unknown>, context: ToolContext) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const invoice = await invoiceService.getInvoiceById(value, context.user.id, permissionScope(context.user.permissionScopes, 'invoices.view'));
    return invoice.invoiceNumber || value;
  } catch {
    return value;
  }
}

async function resolveExpenseCategoryDisplayValue(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const categories = await expenseService.listCategories({ active: true });
    const category = categories.find((entry) => entry.id === value);
    return category?.name ?? value;
  } catch {
    return value;
  }
}

async function resolveExpenseTypeDisplayValue(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const types = await expenseService.listTypes({ active: true });
    const type = types.find((entry) => entry.id === value);
    return type?.name ?? value;
  } catch {
    return value;
  }
}

async function resolveUserDisplayValue(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const users = await userService.getUsers({ page: '1', limit: '50' });
    const user = users.data.find((entry) => entry.id === value);
    return user ? `${user.name} (${user.email})` : value;
  } catch {
    return value;
  }
}

async function resolveRoleDisplayValue(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const roles = await rbacService.listRoles();
    const role = roles.find((entry) => entry.id === value);
    return role?.name ?? value;
  } catch {
    return value;
  }
}

async function resolvePermissionDisplayValue(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const permissions = await rbacService.listPermissions();
    const permission = permissions.find((entry) => entry.id === value);
    return permission?.key ?? value;
  } catch {
    return value;
  }
}

async function resolveCreditNoteReasonDisplayValue(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const reasons = await creditNoteService.getReasons(false);
    const reason = reasons.find((entry) => entry.id === value);
    return reason?.nameFr || reason?.nameEn || reason?.code || value;
  } catch {
    return value;
  }
}

function currencyOptions() {
  return [
    option('MAD', 'Dirham marocain (MAD)', 'Moroccan dirham (MAD)', 'الدرهم المغربي (MAD)'),
    option('EUR', 'Euro (EUR)', 'Euro (EUR)', 'اليورو (EUR)'),
    option('USD', 'Dollar américain (USD)', 'US dollar (USD)', 'الدولار الأمريكي (USD)'),
  ];
}

const invoiceLineItemFields = [
  { path: 'description', type: 'text', label: text('Description', 'Description', 'الوصف'), required: true, placeholder: text('Prestation ou produit', 'Service or product', 'الخدمة أو المنتج') },
  { path: 'quantity', type: 'number', label: text('Quantité', 'Quantity', 'الكمية'), required: true, defaultValue: 1 },
  { path: 'unitPrice', type: 'currency', label: text('Prix unitaire', 'Unit price', 'سعر الوحدة'), required: true, defaultValue: 0 },
  { path: 'taxRate', type: 'number', label: text('TVA %', 'VAT %', 'نسبة الضريبة %'), defaultValue: 20 },
  { path: 'unit', type: 'text', label: text('Unité', 'Unit', 'الوحدة'), placeholder: text('heure, jour, pièce…', 'hour, day, unit…', 'ساعة، يوم، وحدة…') },
] as const;

const quoteLineItemFields = [
  ...invoiceLineItemFields,
  { path: 'discount', type: 'currency', label: text('Remise', 'Discount', 'الخصم'), defaultValue: 0 },
] as const;

const paymentMethodOptions = [
  option('BANK_TRANSFER', 'Virement bancaire', 'Bank transfer', 'تحويل بنكي'),
  option('CASH', 'Espèces', 'Cash', 'نقدا'),
  option('CHECK', 'Chèque', 'Check', 'شيك'),
  option('CARD', 'Carte', 'Card', 'بطاقة'),
  option('OTHER', 'Autre', 'Other', 'أخرى'),
] as const;

const expenseSourceOptions = [
  option('MANUAL', 'Manuel', 'Manual', 'يدوي'),
  option('AI', 'IA', 'AI', 'ذكاء اصطناعي'),
] as const;

const recurringFrequencyOptions = [
  option('WEEKLY', 'Hebdomadaire', 'Weekly', 'أسبوعي'),
  option('MONTHLY', 'Mensuel', 'Monthly', 'شهري'),
  option('QUARTERLY', 'Trimestriel', 'Quarterly', 'ربع سنوي'),
  option('YEARLY', 'Annuel', 'Yearly', 'سنوي'),
] as const;

const reminderTypeOptions = [
  option('MANUAL', 'Manuel', 'Manual', 'يدوي'),
  option('AUTOMATIC', 'Automatique', 'Automatic', 'تلقائي'),
] as const;

const roleOptions = [
  option('ADMIN', 'Administrateur', 'Administrator', 'مسؤول'),
  option('EMPLOYEE', 'Employé', 'Employee', 'موظف'),
] as const;

const permissionScopeOptions = [
  option('ALL', 'Tous', 'All', 'الكل'),
  option('OWN', 'Propre', 'Own', 'الخاص'),
  option('SELECTED', 'Sélection', 'Selected', 'محدد'),
] as const;

export const erpTools: AiTool[] = [
  {
    name: 'search_customers',
    description: 'Search and list customers or clients.',
    module: 'customers',
    requiredPermission: 'clients.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: searchListInput,
    execute: (input, context) => customerService.getCustomers(context.user.id, erpScope(context, 'clients.view'), input),
  },
  {
    name: 'get_customer_details',
    description: 'Get customer details and financial summary.',
    module: 'customers',
    requiredPermission: 'clients.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: entityIdInput,
    execute: (input, context) => customerService.getCustomerById(input.id, context.user.id, erpScope(context, 'clients.view')),
  },
  {
    name: 'create_customer',
    description: 'Create a customer/client.',
    module: 'customers',
    requiredPermission: 'clients.create',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: customerInput,
    form: {
      title: text('Créer un client', 'Create customer', 'إنشاء عميل'),
      description: text('Complétez les informations client avant de générer la prévisualisation.', 'Complete the customer information before generating the preview.', 'أكمل بيانات العميل قبل إنشاء المعاينة.'),
      fields: [
        { path: 'name', type: 'text', label: text('Nom du client', 'Customer name', 'Ø§Ø³Ù… Ø§Ù„Ø¹Ù…ÙŠÙ„'), required: true },
        { path: 'email', type: 'text', label: text('Email', 'Email', 'Ø§Ù„Ø¨Ø±ÙŠØ¯ Ø§Ù„Ø¥Ù„ÙƒØªØ±ÙˆÙ†ÙŠ'), required: true },
        { path: 'phone', type: 'text', label: text('Téléphone', 'Phone', 'الهاتف') },
        { path: 'company', type: 'text', label: text('Société', 'Company', 'الشركة') },
        { path: 'address', type: 'textarea', label: text('Adresse', 'Address', 'Ø§Ù„Ø¹Ù†ÙˆØ§Ù†') },
        { path: 'city', type: 'text', label: text('Ville', 'City', 'Ø§Ù„Ù…Ø¯ÙŠÙ†Ø©') },
        { path: 'country', type: 'text', label: text('Pays', 'Country', 'Ø§Ù„Ø¯ÙˆÙ„Ø©'), required: true },
        { path: 'countryCode', type: 'text', label: text('Code pays', 'Country code', 'Ø±Ù…Ø² Ø§Ù„Ø¯ÙˆÙ„Ø©'), required: true, placeholder: text('MA, FR, USâ€¦', 'MA, FR, USâ€¦', 'MA Ø£Ùˆ FR Ø£Ùˆ USâ€¦') },
        { path: 'postalCode', type: 'text', label: text('Code postal', 'Postal code', 'Ø§Ù„Ø±Ù…Ø² Ø§Ù„Ø¨Ø±ÙŠØ¯ÙŠ') },
        { path: 'taxNumber', type: 'text', label: text('Numéro fiscal', 'Tax number', 'الرقم الضريبي') },
      ],
    },
    preview: async (input) => preview('Create customer', 'A new customer will be created after confirmation.', input),
    execute: (input, context) => customerService.createCustomer(context.user.id, input),
  },
  {
    name: 'update_customer',
    description: 'Update a customer/client.',
    module: 'customers',
    requiredPermission: 'clients.update',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: customerUpdateInput,
    form: {
      title: text('Modifier un client', 'Update customer', 'تعديل عميل'),
      description: text('Ajustez les informations du client avant la previsualisation.', 'Adjust the customer information before preview.', 'عدّل بيانات العميل قبل المعاينة.'),
      buildInitialValue: async (partialInput, context) => {
        if (typeof partialInput.id !== 'string') return {};
        const customer = await customerService.getCustomerById(partialInput.id, context.user.id, erpScope(context, 'clients.view'));
        return {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone ?? '',
          company: customer.company ?? '',
          address: customer.address ?? '',
          city: customer.city ?? '',
          country: customer.country,
          countryCode: customer.countryCode,
          postalCode: customer.postalCode ?? '',
          taxNumber: customer.taxNumber ?? '',
          isActive: customer.isActive,
        };
      },
      fields: [
        { path: 'id', type: 'entity', entityType: 'customer', label: text('Client', 'Customer', 'العميل'), required: true, readOnly: true, resolveDisplayValue: resolveCustomerDisplayValue },
        { path: 'name', type: 'text', label: text('Nom du client', 'Customer name', 'اسم العميل') },
        { path: 'email', type: 'text', label: text('Email', 'Email', 'البريد الالكتروني') },
        { path: 'phone', type: 'text', label: text('Telephone', 'Phone', 'الهاتف') },
        { path: 'company', type: 'text', label: text('Societe', 'Company', 'الشركة') },
        { path: 'address', type: 'textarea', label: text('Adresse', 'Address', 'العنوان') },
        { path: 'city', type: 'text', label: text('Ville', 'City', 'المدينة') },
        { path: 'country', type: 'text', label: text('Pays', 'Country', 'الدولة') },
        { path: 'countryCode', type: 'text', label: text('Code pays', 'Country code', 'رمز الدولة') },
        { path: 'postalCode', type: 'text', label: text('Code postal', 'Postal code', 'الرمز البريدي') },
        { path: 'taxNumber', type: 'text', label: text('Numero fiscal', 'Tax number', 'الرقم الضريبي') },
        { path: 'isActive', type: 'boolean', label: text('Actif', 'Active', 'نشط') },
      ],
    },
    preview: async (input) => preview('Update customer', 'The customer record will be updated after confirmation.', input),
    execute: ({ id, ...data }, context) => customerService.updateCustomer(id, context.user.id, erpScope(context, 'clients.update', AI_ASSISTANT_PERMISSIONS.useWriteTools), data),
  },
  {
    name: 'delete_customer',
    description: 'Delete a customer/client when allowed by business rules.',
    module: 'customers',
    requiredPermission: 'clients.delete',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: entityIdInput,
    preview: async (input) => preview('Delete customer', 'The customer will be deleted if no protected records block the operation.', input),
    execute: (input, context) => customerService.deleteCustomer(input.id, context.user.id, erpScope(context, 'clients.delete', AI_ASSISTANT_PERMISSIONS.useWriteTools)),
  },
  {
    name: 'create_contract',
    description: 'Create a contract.',
    module: 'contracts',
    requiredPermission: 'contracts.create',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: contractCreateInput,
    form: {
      title: text('Créer un contrat', 'Create contract', 'إنشاء عقد'),
      description: text('Renseignez les informations contractuelles avant de générer la prévisualisation.', 'Complete the contract information before generating the preview.', 'أكمل بيانات العقد قبل إنشاء المعاينة.'),
      buildInitialValue: async () => {
        const settings = await settingsService.getCompanySettings();
        return {
          language: 'fr',
          contractType: 'GENERAL',
          renewalType: ContractRenewalType.NONE,
          currency: settings.defaultCurrency,
          pricingType: ContractPricingType.FIXED,
          billingFrequency: ContractBillingFrequency.ONE_TIME,
          taxRate: Number(settings.defaultTaxRate ?? 20),
          paymentTermsDays: 30,
          autoInvoiceEnabled: false,
          prorationPolicy: ContractProrationPolicy.NONE,
        };
      },
      fields: [
        { path: 'clientId', type: 'entity', entityType: 'customer', label: text('Client', 'Customer', 'Ø§Ù„Ø¹Ù…ÙŠÙ„'), required: true, resolveDisplayValue: resolveContractCustomerDisplayValue },
        { path: 'title', type: 'text', label: text('Titre du contrat', 'Contract title', 'Ø¹Ù†ÙˆØ§Ù† Ø§Ù„Ø¹Ù‚Ø¯'), required: true },
        { path: 'contractType', type: 'text', label: text('Type de contrat', 'Contract type', 'Ù†ÙˆØ¹ Ø§Ù„Ø¹Ù‚Ø¯'), required: true },
        { path: 'language', type: 'select', label: text('Langue', 'Language', 'اللغة'), required: true, options: [option('fr', 'Français', 'French', 'الفرنسية'), option('en', 'Anglais', 'English', 'الإنجليزية'), option('ar', 'Arabe', 'Arabic', 'العربية')] },
        { path: 'startDate', type: 'date', label: text('Date de début', 'Start date', 'تاريخ البداية') },
        { path: 'endDate', type: 'date', label: text('Date de fin', 'End date', 'ØªØ§Ø±ÙŠØ® Ø§Ù„Ù†Ù‡Ø§ÙŠØ©') },
        { path: 'currency', type: 'select', label: text('Devise', 'Currency', 'Ø§Ù„Ø¹Ù…Ù„Ø©'), required: true, options: currencyOptions() },
        { path: 'pricingType', type: 'select', label: text('Tarification', 'Pricing type', 'نوع التسعير'), required: true, options: [option('FIXED', 'Forfait', 'Fixed fee', 'مبلغ ثابت'), option('HOURLY', 'Horaire', 'Hourly', 'بالساعة'), option('DAILY', 'Journalier', 'Daily', 'يومي'), option('MONTHLY', 'Mensuel', 'Monthly', 'شهري'), option('CUSTOM', 'Personnalisé', 'Custom', 'مخصص')] },
        { path: 'fixedAmount', type: 'currency', label: text('Montant forfaitaire', 'Fixed amount', 'Ø§Ù„Ù…Ø¨Ù„Øº Ø§Ù„Ø«Ø§Ø¨Øª') },
        { path: 'unitRate', type: 'currency', label: text('Tarif unitaire', 'Unit rate', 'Ø§Ù„Ø³Ø¹Ø± Ø§Ù„ÙˆØ­Ø¯ÙˆÙŠ') },
        { path: 'estimatedQuantity', type: 'number', label: text('Quantité estimée', 'Estimated quantity', 'الكمية التقديرية') },
        { path: 'billingFrequency', type: 'select', label: text('Fréquence de facturation', 'Billing frequency', 'وتيرة الفوترة'), required: true, options: [option('ONE_TIME', 'Une seule fois', 'One time', 'مرة واحدة'), option('DAILY', 'Quotidienne', 'Daily', 'يومي'), option('WEEKLY', 'Hebdomadaire', 'Weekly', 'أسبوعي'), option('MONTHLY', 'Mensuelle', 'Monthly', 'شهري'), option('QUARTERLY', 'Trimestrielle', 'Quarterly', 'ربع سنوي'), option('SEMI_ANNUAL', 'Semestrielle', 'Semi annual', 'نصف سنوي'), option('ANNUAL', 'Annuelle', 'Annual', 'سنوي')] },
        { path: 'taxRate', type: 'number', label: text('TVA %', 'VAT %', 'Ù†Ø³Ø¨Ø© Ø§Ù„Ø¶Ø±ÙŠØ¨Ø© %') },
        { path: 'paymentTermsDays', type: 'number', label: text('Délai de paiement (jours)', 'Payment terms (days)', 'أجل الدفع بالأيام') },
        { path: 'billingDescription', type: 'textarea', label: text('Description de facturation', 'Billing description', 'ÙˆØµÙ Ø§Ù„ÙÙˆØªØ±Ø©') },
        { path: 'summary', type: 'textarea', label: text('Résumé', 'Summary', 'الملخص') },
        { path: 'terms', type: 'textarea', label: text('Conditions', 'Terms', 'Ø§Ù„Ø´Ø±ÙˆØ·') },
        { path: 'content', type: 'textarea', label: text('Contenu du contrat', 'Contract content', 'Ù…Ø­ØªÙˆÙ‰ Ø§Ù„Ø¹Ù‚Ø¯') },
      ],
    },
    preview: async (input) => preview('Create contract', 'A new contract will be created after confirmation.', input),
    execute: (input, context) => contractService.create(context.user, erpScope(context, 'contracts.create', AI_ASSISTANT_PERMISSIONS.useWriteTools), input),
  },
  {
    name: 'update_contract',
    description: 'Update a contract.',
    module: 'contracts',
    requiredPermission: 'contracts.update',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: contractUpdateInput,
    form: {
      title: text('Modifier un contrat', 'Update contract', 'تعديل عقد'),
      description: text('Ajustez les champs du contrat avant la previsualisation.', 'Adjust the contract fields before preview.', 'عدّل حقول العقد قبل المعاينة.'),
      buildInitialValue: async (partialInput, context) => {
        if (typeof partialInput.id !== 'string') return {};
        const contract = await contractService.getById(partialInput.id, context.user.id, erpScope(context, 'contracts.view'));
        return {
          id: contract.id,
          title: contract.title,
          contractType: contract.contractType,
          language: contract.language,
          startDate: contract.startDate ? new Date(contract.startDate).toISOString().slice(0, 10) : '',
          endDate: contract.endDate ? new Date(contract.endDate).toISOString().slice(0, 10) : '',
          renewalType: contract.renewalType,
          renewalNoticeDays: contract.renewalNoticeDays ?? null,
          amount: Number(contract.amount ?? 0),
          currency: contract.currency,
          pricingType: contract.pricingType,
          unitRate: Number(contract.unitRate ?? 0),
          estimatedQuantity: Number(contract.estimatedQuantity ?? 0),
          fixedAmount: Number(contract.fixedAmount ?? 0),
          billingFrequency: contract.billingFrequency,
          billingDay: contract.billingDay ?? null,
          billingStartDate: contract.billingStartDate ? new Date(contract.billingStartDate).toISOString().slice(0, 10) : '',
          billingEndDate: contract.billingEndDate ? new Date(contract.billingEndDate).toISOString().slice(0, 10) : '',
          minimumBillableUnits: Number(contract.minimumBillableUnits ?? 0),
          includedUnits: Number(contract.includedUnits ?? 0),
          overtimeRate: Number(contract.overtimeRate ?? 0),
          taxRate: Number(contract.taxRate ?? 0),
          paymentTermsDays: Number(contract.paymentTermsDays ?? 30),
          autoInvoiceEnabled: contract.autoInvoiceEnabled,
          nextInvoiceDate: contract.nextInvoiceDate ? new Date(contract.nextInvoiceDate).toISOString().slice(0, 10) : '',
          lastInvoiceDate: contract.lastInvoiceDate ? new Date(contract.lastInvoiceDate).toISOString().slice(0, 10) : '',
          prorationPolicy: contract.prorationPolicy,
          billingDescription: contract.billingDescription ?? '',
          summary: contract.summary ?? '',
          terms: contract.terms ?? '',
        };
      },
      fields: [
        { path: 'id', type: 'text', label: text('Contrat', 'Contract', 'العقد'), required: true, hidden: true },
        { path: 'title', type: 'text', label: text('Titre', 'Title', 'العنوان') },
        { path: 'contractType', type: 'text', label: text('Type de contrat', 'Contract type', 'نوع العقد') },
        { path: 'language', type: 'select', label: text('Langue', 'Language', 'اللغة'), options: [option('fr', 'Francais', 'French', 'الفرنسية'), option('en', 'Anglais', 'English', 'الانجليزية'), option('ar', 'Arabe', 'Arabic', 'العربية')] },
        { path: 'startDate', type: 'date', label: text('Date de debut', 'Start date', 'تاريخ البداية') },
        { path: 'endDate', type: 'date', label: text('Date de fin', 'End date', 'تاريخ الانتهاء') },
        { path: 'amount', type: 'currency', label: text('Montant', 'Amount', 'المبلغ') },
        { path: 'currency', type: 'select', label: text('Devise', 'Currency', 'العملة'), options: currencyOptions() },
        { path: 'pricingType', type: 'select', label: text('Mode de tarification', 'Pricing type', 'نوع التسعير'), options: [option('FIXED', 'Forfait', 'Fixed', 'ثابت'), option('HOURLY', 'Horaire', 'Hourly', 'بالساعة'), option('DAILY', 'Journalier', 'Daily', 'يومي'), option('MONTHLY', 'Mensuel', 'Monthly', 'شهري'), option('CUSTOM', 'Personnalise', 'Custom', 'مخصص')] },
        { path: 'unitRate', type: 'currency', label: text('Tarif unitaire', 'Unit rate', 'السعر الوحدوي') },
        { path: 'fixedAmount', type: 'currency', label: text('Montant forfaitaire', 'Fixed amount', 'المبلغ الثابت') },
        { path: 'billingFrequency', type: 'select', label: text('Frequence de facturation', 'Billing frequency', 'تكرار الفوترة'), options: [option('ONE_TIME', 'Une seule fois', 'One time', 'مرة واحدة'), option('DAILY', 'Quotidienne', 'Daily', 'يومي'), option('WEEKLY', 'Hebdomadaire', 'Weekly', 'اسبوعي'), option('MONTHLY', 'Mensuelle', 'Monthly', 'شهري'), option('QUARTERLY', 'Trimestrielle', 'Quarterly', 'ربع سنوي'), option('YEARLY', 'Annuelle', 'Yearly', 'سنوي')] },
        { path: 'taxRate', type: 'number', label: text('TVA %', 'VAT %', 'نسبة الضريبة %') },
        { path: 'paymentTermsDays', type: 'number', label: text('Delai de paiement', 'Payment terms', 'مهلة السداد') },
        { path: 'autoInvoiceEnabled', type: 'boolean', label: text('Facturation automatique', 'Automatic invoicing', 'فوترة تلقائية') },
        { path: 'billingDescription', type: 'textarea', label: text('Description de facturation', 'Billing description', 'وصف الفوترة') },
        { path: 'summary', type: 'textarea', label: text('Resume', 'Summary', 'الملخص') },
        { path: 'terms', type: 'textarea', label: text('Conditions', 'Terms', 'الشروط') },
      ],
    },
    preview: async (input) => preview('Update contract', 'The contract will be updated after confirmation.', input),
    execute: ({ id, ...data }, context) => contractService.update(id, context.user, erpScope(context, 'contracts.update', AI_ASSISTANT_PERMISSIONS.useWriteTools), data),
  },
  {
    name: 'delete_draft_contract',
    description: 'Delete a draft contract when allowed.',
    module: 'contracts',
    requiredPermission: 'contracts.delete',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: entityIdInput,
    preview: async (input) => preview('Delete draft contract', 'The draft contract will be deleted after confirmation if business rules allow it.', input),
    execute: (input, context) => contractService.deleteDraft(input.id, context.user.id, erpScope(context, 'contracts.delete', AI_ASSISTANT_PERMISSIONS.useWriteTools)),
  },
  {
    name: 'update_contract_status',
    description: 'Transition a contract to another business status.',
    module: 'contracts',
    requiredPermission: 'contracts.update',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: contractStatusInput,
    preview: async (input) => preview('Update contract status', 'The contract status will be changed after confirmation.', input),
    execute: (input, context) => contractService.transition(input.id, context.user, erpScope(context, 'contracts.update', AI_ASSISTANT_PERMISSIONS.useWriteTools), input.status),
  },
  {
    name: 'sign_contract_for_company',
    description: 'Sign a contract with the configured company signature and stamp.',
    module: 'signature',
    requiredPermission: 'contracts.sign.company',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: entityIdInput,
    preview: async (input) => preview('Sign contract', 'The company signature and stamp will be applied to the contract after confirmation.', input),
    execute: (input, context) => contractService.signForCompany(input.id, context.user, erpScope(context, 'contracts.sign.company', AI_ASSISTANT_PERMISSIONS.useWriteTools)),
  },
  {
    name: 'revoke_contract_signature',
    description: 'Revoke a contract signature.',
    module: 'signature',
    requiredPermission: 'contracts.signature.revoke',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: contractRevokeSignatureInput,
    preview: async (input) => preview('Revoke contract signature', 'The contract signature will be revoked after confirmation.', input),
    execute: ({ id, ...data }, context) => contractService.revokeSignature(id, context.user, erpScope(context, 'contracts.signature.revoke', AI_ASSISTANT_PERMISSIONS.useWriteTools), data),
  },
  {
    name: 'send_contract_email',
    description: 'Send a contract by email with PDF and optional signature link.',
    module: 'email',
    requiredPermission: 'contracts.email.send',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: contractEmailInput,
    preview: async (input) => preview('Send contract email', 'The contract PDF will be emailed by the backend after confirmation.', input),
    execute: ({ id, ...data }, context) => contractService.sendByEmail(id, context.user, erpScope(context, 'contracts.email.send', AI_ASSISTANT_PERMISSIONS.useWriteTools), data),
  },
  {
    name: 'generate_contract_pdf',
    description: 'Prepare secure contract PDF download information for an authorized contract.',
    module: 'pdf',
    requiredPermission: 'contracts.pdf.download',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: entityIdInput.extend({ language: z.enum(['fr', 'en', 'ar']).optional() }).strict(),
    execute: async (input, context) => {
      const contract = await contractService.getById(input.id, context.user.id, erpScope(context, 'contracts.pdf.download'));
      return {
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        downloadEndpoint: `/api/contracts/${contract.id}/pdf`,
      };
    },
  },
  {
    name: 'search_invoices',
    description: 'Search and list invoices.',
    module: 'invoices',
    requiredPermission: 'invoices.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: searchListInput.extend({ status: z.nativeEnum(InvoiceStatus).optional(), customerId: uuid.optional(), dateFrom: optionalDate, dateTo: optionalDate }).strict(),
    execute: (input, context) => invoiceService.getInvoices(context.user.id, erpScope(context, 'invoices.view'), input),
  },
  {
    name: 'create_invoice',
    description: 'Create a manual, ad-hoc invoice with explicitly given line items and a customerId. Do NOT use this when the request references an existing contract by number or by name â€” use contract_invoice_workflow instead so billing is generated from that contract\'s approved timesheets/schedule.',
    module: 'invoices',
    requiredPermission: 'invoices.create',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: invoiceCreateInput,
    form: {
      title: text('Créer une facture', 'Create invoice', 'إنشاء فاتورة'),
      description: text('Complétez les champs manquants pour préparer une facture manuelle.', 'Complete the missing fields to prepare a manual invoice.', 'أكمل الحقول الناقصة لتحضير فاتورة يدوية.'),
      buildInitialValue: async () => {
        const settings = await settingsService.getCompanySettings();
        return {
          issueDate: new Date().toISOString().slice(0, 10),
          currency: settings.defaultCurrency,
          taxRate: Number(settings.defaultTaxRate ?? 20),
          discount: 0,
          items: [],
        };
      },
      fields: [
        { path: 'customerId', type: 'entity', entityType: 'customer', label: text('Client', 'Customer', 'Ø§Ù„Ø¹Ù…ÙŠÙ„'), required: true, resolveDisplayValue: resolveCustomerDisplayValue },
        { path: 'issueDate', type: 'date', label: text('Date d’émission', 'Issue date', 'تاريخ الإصدار'), required: true },
        { path: 'dueDate', type: 'date', label: text('Date d’échéance', 'Due date', 'تاريخ الاستحقاق'), required: true },
        { path: 'currency', type: 'select', label: text('Devise', 'Currency', 'Ø§Ù„Ø¹Ù…Ù„Ø©'), required: true, options: currencyOptions() },
        { path: 'taxRate', type: 'number', label: text('TVA %', 'VAT %', 'Ù†Ø³Ø¨Ø© Ø§Ù„Ø¶Ø±ÙŠØ¨Ø© %') },
        { path: 'discount', type: 'currency', label: text('Remise globale', 'Global discount', 'Ø§Ù„Ø®ØµÙ… Ø§Ù„Ø¥Ø¬Ù…Ø§Ù„ÙŠ') },
        { path: 'notes', type: 'textarea', label: text('Notes', 'Notes', 'Ù…Ù„Ø§Ø­Ø¸Ø§Øª') },
        { path: 'terms', type: 'textarea', label: text('Conditions', 'Terms', 'Ø§Ù„Ø´Ø±ÙˆØ·') },
        { path: 'items', type: 'array', label: text('Lignes de facture', 'Invoice lines', 'Ø¨Ù†ÙˆØ¯ Ø§Ù„ÙØ§ØªÙˆØ±Ø©'), required: true, minItems: 1, itemFields: [...invoiceLineItemFields] },
      ],
    },
    preview: async (input) => preview('Create invoice', 'A draft or selected-status invoice will be created after confirmation.', input),
    execute: (input, context) => invoiceService.createInvoice(context.user, erpScope(context, 'invoices.create', AI_ASSISTANT_PERMISSIONS.useWriteTools), input),
  },
  {
    name: 'update_invoice',
    description: 'Update an invoice.',
    module: 'invoices',
    requiredPermission: 'invoices.update',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: invoiceUpdateInput,
    form: {
      title: text('Modifier une facture', 'Update invoice', 'ØªØ¹Ø¯ÙŠÙ„ ÙØ§ØªÙˆØ±Ø©'),
      description: text('Ajustez les champs modifiables de la facture avant la previsualisation.', 'Adjust the editable invoice fields before preview.', 'Ø¹Ø¯Ù‘Ù„ Ø­Ù‚ÙˆÙ„ Ø§Ù„ÙØ§ØªÙˆØ±Ø© Ø§Ù„Ù‚Ø§Ø¨Ù„Ø© Ù„Ù„ØªØºÙŠÙŠØ± Ù‚Ø¨Ù„ Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø©.'),
      buildInitialValue: async (partialInput, context) => {
        if (typeof partialInput.id !== 'string') return {};
        const invoice = await invoiceService.getInvoiceById(partialInput.id, context.user.id, erpScope(context, 'invoices.view'));
        return {
          id: invoice.id,
          customerId: invoice.customerId,
          issueDate: new Date(invoice.issueDate).toISOString().slice(0, 10),
          dueDate: new Date(invoice.dueDate).toISOString().slice(0, 10),
          currency: invoice.currency,
          taxRate: Number(invoice.taxRate ?? 0),
          discount: Number(invoice.discount ?? 0),
          notes: invoice.notes ?? '',
          terms: invoice.terms ?? '',
          items: (invoice.items ?? []).map((item) => ({
            description: item.description,
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice),
            taxRate: Number(item.taxRate ?? invoice.taxRate ?? 0),
            unit: item.unit ?? '',
          })),
        };
      },
      fields: [
        { path: 'id', type: 'text', label: text('Facture', 'Invoice', 'Ø§Ù„ÙØ§ØªÙˆØ±Ø©'), required: true, hidden: true },
        { path: 'customerId', type: 'entity', entityType: 'customer', label: text('Client', 'Customer', 'Ø§Ù„Ø¹Ù…ÙŠÙ„'), required: true, resolveDisplayValue: resolveCustomerDisplayValue },
        { path: 'issueDate', type: 'date', label: text('Date emission', 'Issue date', 'ØªØ§Ø±ÙŠØ® Ø§Ù„Ø§ØµØ¯Ø§Ø±'), required: true },
        { path: 'dueDate', type: 'date', label: text('Date echeance', 'Due date', 'ØªØ§Ø±ÙŠØ® Ø§Ù„Ø§Ø³ØªØ­Ù‚Ø§Ù‚'), required: true },
        { path: 'currency', type: 'select', label: text('Devise', 'Currency', 'Ø§Ù„Ø¹Ù…Ù„Ø©'), required: true, options: currencyOptions() },
        { path: 'taxRate', type: 'number', label: text('TVA %', 'VAT %', 'Ù†Ø³Ø¨Ø© Ø§Ù„Ø¶Ø±ÙŠØ¨Ø© %') },
        { path: 'discount', type: 'currency', label: text('Remise globale', 'Global discount', 'Ø§Ù„Ø®ØµÙ… Ø§Ù„Ø§Ø¬Ù…Ø§Ù„ÙŠ') },
        { path: 'notes', type: 'textarea', label: text('Notes', 'Notes', 'Ù…Ù„Ø§Ø­Ø¸Ø§Øª') },
        { path: 'terms', type: 'textarea', label: text('Conditions', 'Terms', 'Ø§Ù„Ø´Ø±ÙˆØ·') },
        { path: 'items', type: 'array', label: text('Lignes de facture', 'Invoice lines', 'Ø¨Ù†ÙˆØ¯ Ø§Ù„ÙØ§ØªÙˆØ±Ø©'), required: true, minItems: 1, itemFields: [...invoiceLineItemFields] },
      ],
    },
    preview: async (input) => preview('Update invoice', 'The invoice will be updated after confirmation.', input),
    execute: ({ id, ...data }, context) => invoiceService.updateInvoice(id, context.user, erpScope(context, 'invoices.update', AI_ASSISTANT_PERMISSIONS.useWriteTools), data),
  },
  {
    name: 'update_invoice_status',
    description: 'Change invoice status.',
    module: 'invoices',
    requiredPermission: 'invoices.update',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: invoiceStatusInput,
    preview: async (input) => preview('Update invoice status', 'The invoice status will be changed after confirmation.', input),
    execute: (input, context) => invoiceService.updateStatus(input.id, context.user.id, erpScope(context, 'invoices.update', AI_ASSISTANT_PERMISSIONS.useWriteTools), input.status),
  },
  {
    name: 'sign_invoice',
    description: 'Apply company signature and stamp to an invoice.',
    module: 'signature',
    requiredPermission: 'invoices.sign',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: entityIdInput,
    preview: async (input) => preview('Sign invoice', 'The configured company signature and stamp will be applied.', input),
    execute: (input, context) => invoiceService.signInvoice(input.id, context.user.id, erpScope(context, 'invoices.sign', AI_ASSISTANT_PERMISSIONS.useWriteTools)),
  },
  {
    name: 'cancel_invoice_signature',
    description: 'Remove the electronic signature from an invoice.',
    module: 'signature',
    requiredPermission: 'invoices.sign',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: entityIdInput,
    preview: async (input) => preview('Cancel invoice signature', 'The invoice signature will be removed after confirmation.', input),
    execute: (input, context) => invoiceService.cancelInvoiceSignature(input.id, context.user.id, erpScope(context, 'invoices.sign', AI_ASSISTANT_PERMISSIONS.useWriteTools)),
  },
  {
    name: 'record_invoice_payment',
    description: 'Record a payment for an invoice.',
    module: 'payments',
    requiredPermission: 'payments.create',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: invoicePaymentInput,
    form: {
      title: text('Enregistrer un paiement', 'Record invoice payment', 'ØªØ³Ø¬ÙŠÙ„ Ø¯ÙØ¹Ø©'),
      description: text('Confirmez les informations de paiement avant la previsualisation.', 'Confirm the payment details before preview.', 'Ø£ÙƒØ¯ Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø¯ÙØ¹ Ù‚Ø¨Ù„ Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø©.'),
      buildInitialValue: async () => ({
        paymentDate: new Date().toISOString().slice(0, 10),
        method: 'BANK_TRANSFER',
      }),
      fields: [
        { path: 'invoiceId', type: 'entity', entityType: 'invoice', label: text('Facture', 'Invoice', 'Ø§Ù„ÙØ§ØªÙˆØ±Ø©'), required: true, readOnly: true, resolveDisplayValue: resolveInvoiceDisplayValue },
        { path: 'amount', type: 'currency', label: text('Montant', 'Amount', 'Ø§Ù„Ù…Ø¨Ù„Øº'), required: true },
        { path: 'paymentDate', type: 'date', label: text('Date de paiement', 'Payment date', 'ØªØ§Ø±ÙŠØ® Ø§Ù„Ø¯ÙØ¹'), required: true },
        { path: 'method', type: 'select', label: text('Mode de paiement', 'Payment method', 'Ø·Ø±ÙŠÙ‚Ø© Ø§Ù„Ø¯ÙØ¹'), required: true, options: [...paymentMethodOptions] },
        { path: 'reference', type: 'text', label: text('Reference', 'Reference', 'Ø§Ù„Ù…Ø±Ø¬Ø¹') },
        { path: 'notes', type: 'textarea', label: text('Notes', 'Notes', 'Ù…Ù„Ø§Ø­Ø¸Ø§Øª') },
      ],
    },
    preview: async (input) => preview('Record payment', 'A payment will be recorded against the invoice after confirmation.', input),
    execute: ({ invoiceId, ...data }, context) => invoiceService.addPayment(invoiceId, context.user.id, erpScope(context, 'payments.create', AI_ASSISTANT_PERMISSIONS.useWriteTools), data),
  },
  {
    name: 'search_payments',
    description: 'Search and list payments.',
    module: 'payments',
    requiredPermission: 'payments.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: searchListInput.extend({ invoiceId: uuid.optional(), customerId: uuid.optional(), dateFrom: optionalDate, dateTo: optionalDate }).strict(),
    execute: (input, context) => paymentService.getPayments(context.user.id, erpScope(context, 'payments.view'), input),
  },
  {
    name: 'search_quotes',
    description: 'Search and list quotes/devis.',
    module: 'quotes',
    requiredPermission: 'devis.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: searchListInput.extend({ status: z.nativeEnum(DevisStatus).optional(), customerId: uuid.optional(), dateFrom: optionalDate, dateTo: optionalDate }).strict(),
    execute: (input, context) => devisService.getDevis(context.user.id, erpScope(context, 'devis.view'), input),
  },
  {
    name: 'get_quote_details',
    description: 'Get quote/devis details.',
    module: 'quotes',
    requiredPermission: 'devis.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: entityIdInput,
    execute: (input, context) => devisService.getDevisById(input.id, context.user.id, erpScope(context, 'devis.view')),
  },
  {
    name: 'generate_quote_pdf',
    description: 'Prepare quote/devis PDF information.',
    module: 'quotes',
    requiredPermission: 'devis.download',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: entityIdInput,
    execute: async (input, context) => {
      const quote = await devisService.getDevisById(input.id, context.user.id, erpScope(context, 'devis.download'));
      return {
        id: quote.id,
        devisNumber: quote.devisNumber,
        status: quote.status,
        customerName: quote.customer?.company || quote.customer?.name,
        downloadEndpoint: `/api/devis/${quote.id}/pdf`,
      };
    },
  },
  {
    name: 'create_quote',
    description: 'Create a quote/devis.',
    module: 'quotes',
    requiredPermission: 'devis.create',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: quoteCreateInput,
    form: {
      title: text('Créer un devis', 'Create quote', 'إنشاء عرض سعر'),
      description: text('Complétez les informations du devis avant de générer la prévisualisation.', 'Complete the quote information before generating the preview.', 'أكمل بيانات عرض السعر قبل إنشاء المعاينة.'),
      buildInitialValue: async () => {
        const settings = await settingsService.getCompanySettings();
        return {
          issueDate: new Date().toISOString().slice(0, 10),
          currency: settings.defaultCurrency,
          taxRate: Number(settings.defaultTaxRate ?? 20),
          discount: 0,
          items: [],
        };
      },
      fields: [
        { path: 'customerId', type: 'entity', entityType: 'customer', label: text('Client', 'Customer', 'Ø§Ù„Ø¹Ù…ÙŠÙ„'), required: true, resolveDisplayValue: resolveCustomerDisplayValue },
        { path: 'issueDate', type: 'date', label: text('Date d’émission', 'Issue date', 'تاريخ الإصدار'), required: true },
        { path: 'validUntil', type: 'date', label: text('Valable jusquâ€™au', 'Valid until', 'ØµØ§Ù„Ø­ Ø¥Ù„Ù‰ ØºØ§ÙŠØ©'), required: true },
        { path: 'currency', type: 'select', label: text('Devise', 'Currency', 'Ø§Ù„Ø¹Ù…Ù„Ø©'), required: true, options: currencyOptions() },
        { path: 'taxRate', type: 'number', label: text('TVA %', 'VAT %', 'Ù†Ø³Ø¨Ø© Ø§Ù„Ø¶Ø±ÙŠØ¨Ø© %') },
        { path: 'discount', type: 'currency', label: text('Remise globale', 'Global discount', 'Ø§Ù„Ø®ØµÙ… Ø§Ù„Ø¥Ø¬Ù…Ø§Ù„ÙŠ') },
        { path: 'notes', type: 'textarea', label: text('Notes', 'Notes', 'Ù…Ù„Ø§Ø­Ø¸Ø§Øª') },
        { path: 'terms', type: 'textarea', label: text('Conditions', 'Terms', 'Ø§Ù„Ø´Ø±ÙˆØ·') },
        { path: 'items', type: 'array', label: text('Lignes du devis', 'Quote lines', 'Ø¨Ù†ÙˆØ¯ Ø¹Ø±Ø¶ Ø§Ù„Ø³Ø¹Ø±'), required: true, minItems: 1, itemFields: [...quoteLineItemFields] },
      ],
    },
    preview: async (input) => preview('Create quote', 'A quote will be created after confirmation.', input),
    execute: (input, context) => devisService.createDevis(context.user, erpScope(context, 'devis.create', AI_ASSISTANT_PERMISSIONS.useWriteTools), input),
  },
  {
    name: 'update_quote',
    description: 'Update a quote/devis.',
    module: 'quotes',
    requiredPermission: 'devis.update',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: quoteUpdateInput,
    form: {
      title: text('Modifier un devis', 'Update quote', 'ØªØ¹Ø¯ÙŠÙ„ Ø¹Ø±Ø¶ Ø³Ø¹Ø±'),
      description: text('Ajustez les champs du devis avant la previsualisation.', 'Adjust the quote fields before preview.', 'Ø¹Ø¯Ù‘Ù„ Ø­Ù‚ÙˆÙ„ Ø¹Ø±Ø¶ Ø§Ù„Ø³Ø¹Ø± Ù‚Ø¨Ù„ Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø©.'),
      buildInitialValue: async (partialInput, context) => {
        if (typeof partialInput.id !== 'string') return {};
        const quote = await devisService.getDevisById(partialInput.id, context.user.id, erpScope(context, 'devis.view'));
        return {
          id: quote.id,
          customerId: quote.customerId,
          issueDate: new Date(quote.issueDate).toISOString().slice(0, 10),
          validUntil: new Date(quote.validUntil).toISOString().slice(0, 10),
          currency: quote.currency,
          taxRate: Number(quote.taxRate ?? 0),
          discount: Number(quote.discount ?? 0),
          notes: quote.notes ?? '',
          terms: quote.terms ?? '',
          items: (quote.items ?? []).map((item) => ({
            description: item.description,
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice),
            taxRate: Number(item.taxRate ?? quote.taxRate ?? 0),
            unit: item.unit ?? '',
            discount: Number(item.discount ?? 0),
          })),
        };
      },
      fields: [
        { path: 'id', type: 'text', label: text('Devis', 'Quote', 'Ø¹Ø±Ø¶ Ø§Ù„Ø³Ø¹Ø±'), required: true, hidden: true },
        { path: 'customerId', type: 'entity', entityType: 'customer', label: text('Client', 'Customer', 'Ø§Ù„Ø¹Ù…ÙŠÙ„'), required: true, resolveDisplayValue: resolveCustomerDisplayValue },
        { path: 'issueDate', type: 'date', label: text('Date emission', 'Issue date', 'ØªØ§Ø±ÙŠØ® Ø§Ù„Ø§ØµØ¯Ø§Ø±'), required: true },
        { path: 'validUntil', type: 'date', label: text('Valable jusqu au', 'Valid until', 'ØµØ§Ù„Ø­ Ø§Ù„Ù‰ ØºØ§ÙŠØ©'), required: true },
        { path: 'currency', type: 'select', label: text('Devise', 'Currency', 'Ø§Ù„Ø¹Ù…Ù„Ø©'), required: true, options: currencyOptions() },
        { path: 'taxRate', type: 'number', label: text('TVA %', 'VAT %', 'Ù†Ø³Ø¨Ø© Ø§Ù„Ø¶Ø±ÙŠØ¨Ø© %') },
        { path: 'discount', type: 'currency', label: text('Remise globale', 'Global discount', 'Ø§Ù„Ø®ØµÙ… Ø§Ù„Ø§Ø¬Ù…Ø§Ù„ÙŠ') },
        { path: 'notes', type: 'textarea', label: text('Notes', 'Notes', 'Ù…Ù„Ø§Ø­Ø¸Ø§Øª') },
        { path: 'terms', type: 'textarea', label: text('Conditions', 'Terms', 'Ø§Ù„Ø´Ø±ÙˆØ·') },
        { path: 'items', type: 'array', label: text('Lignes du devis', 'Quote lines', 'Ø¨Ù†ÙˆØ¯ Ø¹Ø±Ø¶ Ø§Ù„Ø³Ø¹Ø±'), required: true, minItems: 1, itemFields: [...quoteLineItemFields] },
      ],
    },
    preview: async (input) => preview('Update quote', 'The quote will be updated after confirmation.', input),
    execute: ({ id, ...data }, context) => devisService.updateDevis(id, context.user, erpScope(context, 'devis.update', AI_ASSISTANT_PERMISSIONS.useWriteTools), data),
  },
  {
    name: 'delete_quote',
    description: 'Delete a quote/devis when allowed.',
    module: 'quotes',
    requiredPermission: 'devis.delete',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: entityIdInput,
    preview: async (input) => preview('Delete quote', 'The quote will be deleted after confirmation if business rules allow it.', input),
    execute: (input, context) => devisService.deleteDevis(input.id, context.user.id, erpScope(context, 'devis.delete', AI_ASSISTANT_PERMISSIONS.useWriteTools)),
  },
  {
    name: 'update_quote_status',
    description: 'Update quote/devis status.',
    module: 'quotes',
    requiredPermission: 'devis.update',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: quoteStatusInput,
    preview: async (input) => preview('Update quote status', 'The quote status will be changed after confirmation.', input),
    execute: (input, context) => devisService.updateStatus(input.id, context.user.id, erpScope(context, 'devis.update', AI_ASSISTANT_PERMISSIONS.useWriteTools), input.status),
  },
  {
    name: 'approve_quote',
    description: 'Approve a quote/devis.',
    module: 'quotes',
    requiredPermission: 'devis.approve',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: entityIdInput,
    preview: async (input) => preview('Approve quote', 'The quote will be approved after confirmation.', input),
    execute: (input, context) => devisService.updateStatus(input.id, context.user.id, erpScope(context, 'devis.approve', AI_ASSISTANT_PERMISSIONS.useWriteTools), DevisStatus.APPROVED),
  },
  {
    name: 'reject_quote',
    description: 'Reject a quote/devis.',
    module: 'quotes',
    requiredPermission: 'devis.reject',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: entityIdInput,
    preview: async (input) => preview('Reject quote', 'The quote will be rejected after confirmation.', input),
    execute: (input, context) => devisService.updateStatus(input.id, context.user.id, erpScope(context, 'devis.reject', AI_ASSISTANT_PERMISSIONS.useWriteTools), DevisStatus.REJECTED),
  },
  {
    name: 'convert_quote_to_invoice',
    description: 'Convert an approved quote/devis to an invoice.',
    module: 'quotes',
    requiredPermission: 'devis.convert',
    additionalPermissions: ['invoices.create'],
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: entityIdInput,
    preview: async (input) => preview('Convert quote to invoice', 'An invoice will be created from the quote after confirmation.', input),
    execute: (input, context) => {
      erpScope(context, 'invoices.create', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return devisService.convertToInvoice(input.id, context.user.id, erpScope(context, 'devis.convert', AI_ASSISTANT_PERMISSIONS.useWriteTools));
    },
  },
  {
    name: 'send_quote_email',
    description: 'Send a quote/devis PDF by email.',
    module: 'email',
    requiredPermission: 'devis.send',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: quoteEmailInput,
    preview: async (input, context) => {
      const quote = await devisService.getDevisById(input.id, context.user.id, erpScope(context, 'devis.send'));
      return {
        title: 'Send quote by email',
        description: `Quote ${quote.devisNumber}`,
        summary: {
          devisNumber: quote.devisNumber,
          customer: quote.customer?.company || quote.customer?.name,
          to: input.recipientEmail ?? quote.customer?.email,
          subject: input.subject ?? `Devis ${quote.devisNumber}`,
          total: Number(quote.total),
          currency: quote.currency,
        },
      };
    },
    execute: ({ id, ...data }, context) => {
      erpScope(context, 'devis.send', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return devisService.sendDevisEmail(id, context.user.id, permissionScope(context.user.permissionScopes, 'devis.send'), data);
    },
  },
  {
    name: 'search_credit_notes',
    description: 'Search and list credit notes/avoirs.',
    module: 'credit_notes',
    requiredPermission: 'credit_notes.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: searchListInput.extend({ status: z.nativeEnum(CreditNoteStatus).optional(), invoiceId: uuid.optional(), customerId: uuid.optional(), dateFrom: optionalDate, dateTo: optionalDate }).strict(),
    execute: (input, context) => creditNoteService.getAll(context.user.id, erpScope(context, 'credit_notes.view'), input),
  },
  {
    name: 'get_credit_note_details',
    description: 'Get credit note details.',
    module: 'credit_notes',
    requiredPermission: 'credit_notes.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: entityIdInput,
    execute: (input, context) => creditNoteService.getById(input.id, context.user.id, erpScope(context, 'credit_notes.view')),
  },
  {
    name: 'list_credit_note_reasons',
    description: 'List active credit note reasons.',
    module: 'credit_notes',
    requiredPermission: 'credit_note_reasons.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: z.object({ includeInactive: z.boolean().optional().default(false) }).strict(),
    execute: (input, context) => {
      erpScope(context, 'credit_note_reasons.view');
      return creditNoteService.getReasons(input.includeInactive);
    },
  },
  {
    name: 'create_credit_note',
    description: 'Create a credit note/avoir.',
    module: 'credit_notes',
    requiredPermission: 'credit_notes.create',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: creditNoteCreateInput,
    form: {
      title: text('Creer un avoir', 'Create credit note', 'Ø§Ù†Ø´Ø§Ø¡ Ø§Ø´Ø¹Ø§Ø± Ø¯Ø§Ø¦Ù†'),
      description: text('Renseignez les informations de l avoir avant la previsualisation.', 'Complete the credit note before preview.', 'Ø§ÙƒÙ…Ù„ Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø§Ø´Ø¹Ø§Ø± Ø§Ù„Ø¯Ø§Ø¦Ù† Ù‚Ø¨Ù„ Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø©.'),
      buildInitialValue: async () => ({
        type: 'PARTIAL',
        issueDate: new Date().toISOString().slice(0, 10),
        lines: [],
      }),
      fields: [
        { path: 'invoiceId', type: 'entity', entityType: 'invoice', label: text('Facture source', 'Source invoice', 'Ø§Ù„ÙØ§ØªÙˆØ±Ø© Ø§Ù„Ù…ØµØ¯Ø±'), required: true, resolveDisplayValue: resolveInvoiceDisplayValue },
        { path: 'type', type: 'select', label: text('Type d avoir', 'Credit note type', 'Ù†ÙˆØ¹ Ø§Ù„Ø§Ø´Ø¹Ø§Ø± Ø§Ù„Ø¯Ø§Ø¦Ù†'), required: true, options: [option('FULL', 'Total', 'Full', 'ÙƒØ§Ù…Ù„'), option('PARTIAL', 'Partiel', 'Partial', 'Ø¬Ø²Ø¦ÙŠ')] },
        { path: 'issueDate', type: 'date', label: text('Date emission', 'Issue date', 'ØªØ§Ø±ÙŠØ® Ø§Ù„Ø§ØµØ¯Ø§Ø±'), required: true },
        { path: 'reasonId', type: 'entity', entityType: 'creditNoteReason', label: text('Motif', 'Reason', 'Ø§Ù„Ø³Ø¨Ø¨'), required: true, resolveDisplayValue: resolveCreditNoteReasonDisplayValue },
        { path: 'reason', type: 'textarea', label: text('Explication detaillee', 'Detailed explanation', 'Ø´Ø±Ø­ Ù…ÙØµÙ„') },
        { path: 'internalComment', type: 'textarea', label: text('Commentaire interne', 'Internal comment', 'Ù…Ù„Ø§Ø­Ø¸Ø© Ø¯Ø§Ø®Ù„ÙŠØ©') },
        { path: 'amountTTC', type: 'currency', label: text('Montant TTC', 'Amount TTC', 'Ø§Ù„Ù…Ø¨Ù„Øº Ø´Ø§Ù…Ù„ Ø§Ù„Ø¶Ø±ÙŠØ¨Ø©') },
        { path: 'lines', type: 'array', label: text('Lignes d avoir', 'Credit note lines', 'Ø¨Ù†ÙˆØ¯ Ø§Ù„Ø§Ø´Ø¹Ø§Ø± Ø§Ù„Ø¯Ø§Ø¦Ù†'), itemFields: [...invoiceLineItemFields] },
      ],
    },
    preview: async (input) => preview('Create credit note', 'A credit note will be created after confirmation.', input),
    execute: (input, context) => creditNoteService.create(context.user.id, erpScope(context, 'credit_notes.create', AI_ASSISTANT_PERMISSIONS.useWriteTools), input),
  },
  {
    name: 'update_credit_note',
    description: 'Update a credit note/avoir.',
    module: 'credit_notes',
    requiredPermission: 'credit_notes.update',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: creditNoteUpdateInput,
    form: {
      title: text('Modifier un avoir', 'Update credit note', 'تعديل اشعار دائن'),
      description: text('Ajustez les champs de l avoir avant la previsualisation.', 'Adjust the credit note fields before preview.', 'عدّل حقول الاشعار الدائن قبل المعاينة.'),
      buildInitialValue: async (partialInput, context) => {
        if (typeof partialInput.id !== 'string') return {};
        const creditNote = await creditNoteService.getById(partialInput.id, context.user.id, erpScope(context, 'credit_notes.view'));
        return {
          id: creditNote.id,
          type: creditNote.type,
          issueDate: new Date(creditNote.issueDate).toISOString().slice(0, 10),
          reasonId: creditNote.reasonId,
          reason: creditNote.reason ?? '',
          internalComment: creditNote.internalComment ?? '',
          amountTTC: Number(creditNote.total ?? 0),
          lines: (creditNote.lines ?? []).map((line) => ({
            description: line.description,
            quantity: Number(line.quantity),
            unitPrice: Number(line.unitPrice),
            taxRate: Number(line.taxRate ?? 0),
            unit: line.unit ?? '',
          })),
        };
      },
      fields: [
        { path: 'id', type: 'text', label: text('Avoir', 'Credit note', 'الاشعار الدائن'), required: true, hidden: true },
        { path: 'type', type: 'select', label: text('Type d avoir', 'Credit note type', 'نوع الاشعار الدائن'), options: [option('FULL', 'Total', 'Full', 'كامل'), option('PARTIAL', 'Partiel', 'Partial', 'جزئي')] },
        { path: 'issueDate', type: 'date', label: text('Date emission', 'Issue date', 'تاريخ الاصدار') },
        { path: 'reasonId', type: 'entity', entityType: 'creditNoteReason', label: text('Motif', 'Reason', 'السبب'), resolveDisplayValue: resolveCreditNoteReasonDisplayValue },
        { path: 'reason', type: 'textarea', label: text('Explication detaillee', 'Detailed explanation', 'شرح مفصل') },
        { path: 'internalComment', type: 'textarea', label: text('Commentaire interne', 'Internal comment', 'ملاحظة داخلية') },
        { path: 'amountTTC', type: 'currency', label: text('Montant TTC', 'Amount TTC', 'المبلغ شامل الضريبة') },
        { path: 'lines', type: 'array', label: text('Lignes d avoir', 'Credit note lines', 'بنود الاشعار الدائن'), itemFields: [...invoiceLineItemFields] },
      ],
    },
    preview: async (input) => preview('Update credit note', 'The credit note will be updated after confirmation.', input),
    execute: ({ id, ...data }, context) => creditNoteService.update(id, context.user.id, erpScope(context, 'credit_notes.update', AI_ASSISTANT_PERMISSIONS.useWriteTools), data),
  },
  {
    name: 'delete_credit_note',
    description: 'Delete a credit note/avoir when allowed.',
    module: 'credit_notes',
    requiredPermission: 'credit_notes.update',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: entityIdInput,
    preview: async (input) => preview('Delete credit note', 'The credit note will be deleted after confirmation if business rules allow it.', input),
    execute: (input, context) => creditNoteService.remove(input.id, context.user.id, erpScope(context, 'credit_notes.update', AI_ASSISTANT_PERMISSIONS.useWriteTools)),
  },
  {
    name: 'validate_credit_note',
    description: 'Validate a credit note/avoir.',
    module: 'credit_notes',
    requiredPermission: 'credit_notes.validate',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: entityIdInput,
    preview: async (input) => preview('Validate credit note', 'The credit note will be validated after confirmation.', input),
    execute: (input, context) => creditNoteService.validate(input.id, context.user.id, erpScope(context, 'credit_notes.validate', AI_ASSISTANT_PERMISSIONS.useWriteTools)),
  },
  {
    name: 'cancel_credit_note',
    description: 'Cancel a credit note/avoir.',
    module: 'credit_notes',
    requiredPermission: 'credit_notes.cancel',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: creditNoteCancelInput,
    preview: async (input) => preview('Cancel credit note', 'The credit note will be cancelled after confirmation.', input),
    execute: ({ id, ...data }, context) => creditNoteService.cancel(id, context.user.id, erpScope(context, 'credit_notes.cancel', AI_ASSISTANT_PERMISSIONS.useWriteTools), data),
  },
  {
    name: 'refund_credit_note',
    description: 'Record a refund for a credit note/avoir.',
    module: 'credit_notes',
    requiredPermission: 'credit_notes.refund',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: creditNoteRefundInput,
    preview: async (input) => preview('Refund credit note', 'A refund will be recorded after confirmation.', input),
    execute: ({ id, ...data }, context) => creditNoteService.refund(id, context.user.id, erpScope(context, 'credit_notes.refund', AI_ASSISTANT_PERMISSIONS.useWriteTools), data),
  },
  {
    name: 'generate_credit_note_pdf',
    description: 'Prepare secure credit note PDF download information for an authorized credit note.',
    module: 'pdf',
    requiredPermission: 'credit_notes.pdf.download',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: entityIdInput.extend({ language: z.enum(['fr', 'en', 'ar']).optional().default('fr') }).strict(),
    execute: async (input, context) => {
      const creditNote = await creditNoteService.getById(input.id, context.user.id, erpScope(context, 'credit_notes.pdf.download'));
      return {
        creditNoteId: creditNote.id,
        creditNoteNumber: creditNote.creditNoteNumber,
        downloadEndpoint: `/api/credit-notes/${creditNote.id}/pdf`,
      };
    },
  },
  {
    name: 'send_credit_note_email',
    description: 'Send a credit note by email.',
    module: 'email',
    requiredPermission: 'credit_notes.email.send',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: creditNoteEmailInput,
    preview: async (input) => preview('Send credit note email', 'The credit note PDF will be emailed by the backend.', input),
    execute: ({ id, ...data }, context) => creditNoteService.sendEmail(id, context.user.id, erpScope(context, 'credit_notes.email.send', AI_ASSISTANT_PERMISSIONS.useWriteTools), data),
  },
  {
    name: 'search_expenses',
    description: 'Search and list expense notes.',
    module: 'expenses',
    requiredPermission: 'expense_notes.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: searchListInput.extend({ status: z.nativeEnum(ExpenseNoteStatus).optional(), source: z.nativeEnum(ExpenseSource).optional(), categoryId: uuid.optional(), expenseTypeId: uuid.optional(), employeeId: uuid.optional(), dateFrom: optionalDate, dateTo: optionalDate, currency: z.string().trim().min(3).max(10).optional() }).strict(),
    execute: (input, context) => expenseService.listNotes(context.user, input),
  },
  {
    name: 'get_expense_details',
    description: 'Get expense note details.',
    module: 'expenses',
    requiredPermission: 'expense_notes.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: entityIdInput,
    execute: (input, context) => {
      erpScope(context, 'expense_notes.view');
      return expenseService.getNote(context.user, input.id);
    },
  },
  {
    name: 'create_expense',
    description: 'Create an expense note.',
    module: 'expenses',
    requiredPermission: 'expense_notes.create',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: expenseCreateInput,
    form: {
      title: text('Creer une note de frais', 'Create expense note', 'Ø§Ù†Ø´Ø§Ø¡ Ù…ØµØ±ÙˆÙ'),
      description: text('Completez les informations de depense avant la previsualisation.', 'Complete the expense information before preview.', 'Ø§ÙƒÙ…Ù„ Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù…ØµØ±ÙˆÙ Ù‚Ø¨Ù„ Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø©.'),
      buildInitialValue: async () => ({
        expenseDate: new Date().toISOString().slice(0, 10),
        currency: 'MAD',
        vatRate: 0,
        vatAmount: 0,
        source: 'MANUAL',
        submit: false,
      }),
      fields: [
        { path: 'categoryId', type: 'entity', entityType: 'expenseCategory', label: text('Categorie', 'Category', 'Ø§Ù„ÙØ¦Ø©'), required: true, resolveDisplayValue: resolveExpenseCategoryDisplayValue },
        { path: 'expenseTypeId', type: 'entity', entityType: 'expenseType', label: text('Type de frais', 'Expense type', 'Ù†ÙˆØ¹ Ø§Ù„Ù…ØµØ±ÙˆÙ'), required: true, resolveDisplayValue: resolveExpenseTypeDisplayValue },
        { path: 'expenseDate', type: 'date', label: text('Date de depense', 'Expense date', 'ØªØ§Ø±ÙŠØ® Ø§Ù„Ù…ØµØ±ÙˆÙ'), required: true },
        { path: 'amountTTC', type: 'currency', label: text('Montant TTC', 'Amount TTC', 'Ø§Ù„Ù…Ø¨Ù„Øº Ø´Ø§Ù…Ù„ Ø§Ù„Ø¶Ø±ÙŠØ¨Ø©'), required: true },
        { path: 'amountHT', type: 'currency', label: text('Montant HT', 'Amount HT', 'Ø§Ù„Ù…Ø¨Ù„Øº Ø¨Ø¯ÙˆÙ† Ø¶Ø±ÙŠØ¨Ø©') },
        { path: 'vatAmount', type: 'currency', label: text('Montant TVA', 'VAT amount', 'Ù…Ø¨Ù„Øº Ø§Ù„Ø¶Ø±ÙŠØ¨Ø©') },
        { path: 'vatRate', type: 'number', label: text('TVA %', 'VAT %', 'Ù†Ø³Ø¨Ø© Ø§Ù„Ø¶Ø±ÙŠØ¨Ø© %') },
        { path: 'currency', type: 'select', label: text('Devise', 'Currency', 'Ø§Ù„Ø¹Ù…Ù„Ø©'), required: true, options: currencyOptions() },
        { path: 'merchantName', type: 'text', label: text('Marchand', 'Merchant', 'Ø§Ù„ØªØ§Ø¬Ø±') },
        { path: 'receiptNumber', type: 'text', label: text('Numero de recu', 'Receipt number', 'Ø±Ù‚Ù… Ø§Ù„Ø§ÙŠØµØ§Ù„') },
        { path: 'comment', type: 'textarea', label: text('Commentaire', 'Comment', 'ØªØ¹Ù„ÙŠÙ‚') },
        { path: 'source', type: 'select', label: text('Source', 'Source', 'Ø§Ù„Ù…ØµØ¯Ø±'), required: true, options: [...expenseSourceOptions] },
        { path: 'submit', type: 'boolean', label: text('Soumettre immediatement', 'Submit immediately', 'Ø§Ø±Ø³Ø§Ù„ Ù…Ø¨Ø§Ø´Ø±Ø©') },
      ],
    },
    preview: async (input) => preview('Create expense note', 'An expense note will be created after confirmation.', input),
    execute: (input, context) => {
      erpScope(context, 'expense_notes.create', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return expenseService.createNote(context.user, input);
    },
  },
  {
    name: 'update_expense',
    description: 'Update an expense note.',
    module: 'expenses',
    requiredPermission: 'expense_notes.update',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: expenseUpdateInput,
    form: {
      title: text('Modifier une note de frais', 'Update expense note', 'تعديل مصروف'),
      description: text('Ajustez les champs de depense avant la previsualisation.', 'Adjust the expense fields before preview.', 'عدّل حقول المصروف قبل المعاينة.'),
      buildInitialValue: async (partialInput, context) => {
        if (typeof partialInput.id !== 'string') return {};
        const expense = await expenseService.getNote(context.user, partialInput.id);
        return {
          id: expense.id,
          categoryId: expense.categoryId,
          expenseTypeId: expense.expenseTypeId,
          expenseDate: new Date(expense.expenseDate).toISOString().slice(0, 10),
          amountTTC: Number(expense.amountTTC),
          amountHT: Number(expense.amountHT ?? 0),
          vatAmount: Number(expense.vatAmount ?? 0),
          vatRate: Number(expense.vatRate ?? 0),
          comment: expense.comment ?? '',
          merchantName: expense.merchantName ?? '',
          receiptNumber: expense.receiptNumber ?? '',
          currency: expense.currency,
          source: expense.source,
        };
      },
      fields: [
        { path: 'id', type: 'text', label: text('Depense', 'Expense', 'المصروف'), required: true, hidden: true },
        { path: 'categoryId', type: 'entity', entityType: 'expenseCategory', label: text('Categorie', 'Category', 'الفئة'), resolveDisplayValue: resolveExpenseCategoryDisplayValue },
        { path: 'expenseTypeId', type: 'entity', entityType: 'expenseType', label: text('Type de frais', 'Expense type', 'نوع المصروف'), resolveDisplayValue: resolveExpenseTypeDisplayValue },
        { path: 'expenseDate', type: 'date', label: text('Date de depense', 'Expense date', 'تاريخ المصروف') },
        { path: 'amountTTC', type: 'currency', label: text('Montant TTC', 'Amount TTC', 'المبلغ شامل الضريبة') },
        { path: 'amountHT', type: 'currency', label: text('Montant HT', 'Amount HT', 'المبلغ بدون ضريبة') },
        { path: 'vatAmount', type: 'currency', label: text('Montant TVA', 'VAT amount', 'مبلغ الضريبة') },
        { path: 'vatRate', type: 'number', label: text('TVA %', 'VAT %', 'نسبة الضريبة %') },
        { path: 'currency', type: 'select', label: text('Devise', 'Currency', 'العملة'), options: currencyOptions() },
        { path: 'merchantName', type: 'text', label: text('Marchand', 'Merchant', 'التاجر') },
        { path: 'receiptNumber', type: 'text', label: text('Numero de recu', 'Receipt number', 'رقم الايصال') },
        { path: 'comment', type: 'textarea', label: text('Commentaire', 'Comment', 'تعليق') },
        { path: 'source', type: 'select', label: text('Source', 'Source', 'المصدر'), options: [...expenseSourceOptions] },
      ],
    },
    preview: async (input) => preview('Update expense note', 'The expense note will be updated after confirmation.', input),
    execute: ({ id, ...data }, context) => {
      erpScope(context, 'expense_notes.update', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return expenseService.updateNote(context.user, id, data);
    },
  },
  {
    name: 'delete_expense',
    description: 'Delete an expense note when allowed.',
    module: 'expenses',
    requiredPermission: 'expense_notes.delete',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: entityIdInput,
    preview: async (input) => preview('Delete expense note', 'The expense note will be deleted after confirmation if business rules allow it.', input),
    execute: (input, context) => {
      erpScope(context, 'expense_notes.delete', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return expenseService.deleteNote(context.user, input.id);
    },
  },
  {
    name: 'submit_expense',
    description: 'Submit an expense note for approval.',
    module: 'expenses',
    requiredPermission: 'expense_notes.submit',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: entityIdInput,
    preview: async (input) => preview('Submit expense note', 'The expense note will be submitted for approval.', input),
    execute: (input, context) => {
      erpScope(context, 'expense_notes.submit', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return expenseService.submitNote(context.user, input.id);
    },
  },
  {
    name: 'approve_expense',
    description: 'Approve an expense note.',
    module: 'expenses',
    requiredPermission: 'expense_notes.approve',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: entityIdInput,
    preview: async (input) => preview('Approve expense note', 'The expense note will be approved after confirmation.', input),
    execute: (input, context) => {
      erpScope(context, 'expense_notes.approve', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return expenseService.approveNote(context.user, input.id);
    },
  },
  {
    name: 'reject_expense',
    description: 'Reject an expense note.',
    module: 'expenses',
    requiredPermission: 'expense_notes.reject',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: expenseRejectInput,
    preview: async (input) => preview('Reject expense note', 'The expense note will be rejected after confirmation.', input),
    execute: (input, context) => {
      erpScope(context, 'expense_notes.reject', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return expenseService.rejectNote(context.user, input.id, input.reason);
    },
  },
  {
    name: 'mark_expense_paid',
    description: 'Mark an approved expense as paid.',
    module: 'expenses',
    requiredPermission: 'expense_notes.mark_paid',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: entityIdInput,
    preview: async (input) => preview('Mark expense paid', 'The expense note will be marked as paid after confirmation.', input),
    execute: (input, context) => {
      erpScope(context, 'expense_notes.mark_paid', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return expenseService.markPaid(context.user, input.id);
    },
  },
  {
    name: 'get_expense_analytics',
    description: 'Get expense analytics.',
    module: 'reports',
    requiredPermission: 'expense_notes.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: searchListInput.extend({ status: z.nativeEnum(ExpenseNoteStatus).optional(), dateFrom: optionalDate, dateTo: optionalDate }).strict(),
    execute: (input, context) => expenseService.getAnalytics(context.user, input),
  },
  {
    name: 'send_expense_email',
    description: 'Send an expense note PDF by email.',
    module: 'email',
    requiredPermission: 'expense_notes.email.send',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: expenseEmailInput,
    preview: async (input) => preview('Send expense email', 'The expense PDF will be emailed by the backend.', input),
    execute: ({ id, ...data }, context) => {
      erpScope(context, 'expense_notes.email.send', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return expenseService.sendNoteEmail(context.user, id, data);
    },
  },
  {
    name: 'generate_expense_pdf',
    description: 'Prepare secure expense note PDF download information for an authorized expense note.',
    module: 'pdf',
    requiredPermission: 'expense_notes.pdf.download',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: entityIdInput.extend({ language: z.enum(['en', 'fr', 'ar']).optional().default('fr') }).strict(),
    execute: async (input, context) => {
      erpScope(context, 'expense_notes.pdf.download');
      const note = await expenseService.getNote(context.user, input.id);
      return {
        expenseId: note.id,
        expenseNumber: note.documentNumber ?? note.receiptNumber ?? note.id,
        downloadEndpoint: `/api/expense-notes/${note.id}/pdf`,
      };
    },
  },
  {
    name: 'list_expense_categories',
    description: 'List expense categories.',
    module: 'expenses',
    requiredPermission: 'expense_notes.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: z.object({ active: z.boolean().optional() }).strict(),
    execute: (input, context) => {
      erpScope(context, 'expense_notes.view');
      return expenseService.listCategories(input);
    },
  },
  {
    name: 'list_expense_types',
    description: 'List expense types.',
    module: 'expenses',
    requiredPermission: 'expense_notes.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: z.object({ categoryId: uuid.optional(), active: z.boolean().optional() }).strict(),
    execute: (input, context) => {
      erpScope(context, 'expense_notes.view');
      return expenseService.listTypes(input);
    },
  },
  {
    name: 'create_expense_category',
    description: 'Create an expense category.',
    module: 'expenses',
    requiredPermission: 'expense_categories.manage',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: expenseCategoryInput,
    form: {
      title: text('Creer une categorie', 'Create category', 'Ø§Ù†Ø´Ø§Ø¡ ÙØ¦Ø©'),
      description: text('Renseignez la categorie avant la previsualisation.', 'Provide the category before preview.', 'Ø§Ø¯Ø®Ù„ Ø§Ù„ÙØ¦Ø© Ù‚Ø¨Ù„ Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø©.'),
      fields: [
        { path: 'name', type: 'text', label: text('Nom', 'Name', 'Ø§Ù„Ø§Ø³Ù…'), required: true },
        { path: 'active', type: 'boolean', label: text('Active', 'Active', 'Ù†Ø´Ø·Ø©') },
      ],
    },
    preview: async (input) => preview('Create expense category', 'A new expense category will be created after confirmation.', input),
    execute: (input, context) => {
      erpScope(context, 'expense_categories.manage', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return expenseService.createCategory(input);
    },
  },
  {
    name: 'update_expense_category',
    description: 'Update an expense category.',
    module: 'expenses',
    requiredPermission: 'expense_categories.manage',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: expenseCategoryUpdateInput,
    form: {
      title: text('Modifier une categorie', 'Update category', 'ØªØ¹Ø¯ÙŠÙ„ ÙØ¦Ø©'),
      description: text('Mettez a jour la categorie de frais avant la previsualisation.', 'Update the expense category before preview.', 'Ø­Ø¯Ù‘Ø« ÙØ¦Ø© Ø§Ù„Ù…ØµØ±ÙˆÙ Ù‚Ø¨Ù„ Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø©.'),
      fields: [
        { path: 'id', type: 'entity', entityType: 'expenseCategory', label: text('Categorie', 'Category', 'Ø§Ù„ÙØ¦Ø©'), required: true, readOnly: true, resolveDisplayValue: resolveExpenseCategoryDisplayValue },
        { path: 'name', type: 'text', label: text('Nom', 'Name', 'Ø§Ù„Ø§Ø³Ù…') },
        { path: 'active', type: 'boolean', label: text('Active', 'Active', 'Ù†Ø´Ø·Ø©') },
      ],
    },
    preview: async (input) => preview('Update expense category', 'The expense category will be updated after confirmation.', input),
    execute: ({ id, ...data }, context) => {
      erpScope(context, 'expense_categories.manage', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return expenseService.updateCategory(id, data);
    },
  },
  {
    name: 'create_expense_type',
    description: 'Create an expense type.',
    module: 'expenses',
    requiredPermission: 'expense_types.manage',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: expenseTypeInput,
    form: {
      title: text('Creer un type de frais', 'Create expense type', 'Ø§Ù†Ø´Ø§Ø¡ Ù†ÙˆØ¹ Ù…ØµØ±ÙˆÙ'),
      description: text('Renseignez le type de frais avant la previsualisation.', 'Provide the expense type before preview.', 'Ø§Ø¯Ø®Ù„ Ù†ÙˆØ¹ Ø§Ù„Ù…ØµØ±ÙˆÙ Ù‚Ø¨Ù„ Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø©.'),
      fields: [
        { path: 'categoryId', type: 'entity', entityType: 'expenseCategory', label: text('Categorie', 'Category', 'Ø§Ù„ÙØ¦Ø©'), required: true, resolveDisplayValue: resolveExpenseCategoryDisplayValue },
        { path: 'name', type: 'text', label: text('Nom', 'Name', 'Ø§Ù„Ø§Ø³Ù…'), required: true },
        { path: 'active', type: 'boolean', label: text('Actif', 'Active', 'Ù†Ø´Ø·') },
      ],
    },
    preview: async (input) => preview('Create expense type', 'A new expense type will be created after confirmation.', input),
    execute: (input, context) => {
      erpScope(context, 'expense_types.manage', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return expenseService.createType(input);
    },
  },
  {
    name: 'update_expense_type',
    description: 'Update an expense type.',
    module: 'expenses',
    requiredPermission: 'expense_types.manage',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: expenseTypeUpdateInput,
    form: {
      title: text('Modifier un type de frais', 'Update expense type', 'ØªØ¹Ø¯ÙŠÙ„ Ù†ÙˆØ¹ Ø§Ù„Ù…ØµØ±ÙˆÙ'),
      description: text('Mettez a jour le type de frais avant la previsualisation.', 'Update the expense type before preview.', 'Ø­Ø¯Ù‘Ø« Ù†ÙˆØ¹ Ø§Ù„Ù…ØµØ±ÙˆÙ Ù‚Ø¨Ù„ Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø©.'),
      fields: [
        { path: 'id', type: 'entity', entityType: 'expenseType', label: text('Type', 'Type', 'Ø§Ù„Ù†ÙˆØ¹'), required: true, readOnly: true, resolveDisplayValue: resolveExpenseTypeDisplayValue },
        { path: 'categoryId', type: 'entity', entityType: 'expenseCategory', label: text('Categorie', 'Category', 'Ø§Ù„ÙØ¦Ø©'), resolveDisplayValue: resolveExpenseCategoryDisplayValue },
        { path: 'name', type: 'text', label: text('Nom', 'Name', 'Ø§Ù„Ø§Ø³Ù…') },
        { path: 'active', type: 'boolean', label: text('Actif', 'Active', 'Ù†Ø´Ø·') },
      ],
    },
    preview: async (input) => preview('Update expense type', 'The expense type will be updated after confirmation.', input),
    execute: ({ id, ...data }, context) => {
      erpScope(context, 'expense_types.manage', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return expenseService.updateType(id, data);
    },
  },
  {
    name: 'get_expense_email_history',
    description: 'Get expense note email history.',
    module: 'email',
    requiredPermission: 'expense_notes.email.history',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: entityIdInput,
    execute: (input, context) => {
      erpScope(context, 'expense_notes.email.history');
      return expenseService.getEmailHistory(context.user, input.id);
    },
  },
  {
    name: 'resend_expense_email',
    description: 'Resend a previously sent expense note email.',
    module: 'email',
    requiredPermission: 'expense_notes.email.resend',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: expenseEmailLogInput,
    preview: async (input) => preview('Resend expense email', 'The expense email will be resent after confirmation.', input),
    execute: (input, context) => {
      erpScope(context, 'expense_notes.email.resend', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return expenseService.resendEmail(context.user, input.emailLogId);
    },
  },
  {
    name: 'export_expenses',
    description: 'Export selected or filtered expense notes as PDF, ZIP, Excel or CSV.',
    module: 'reports',
    requiredPermission: 'expense_notes.export.excel',
    anyPermissions: ['expense_notes.export.excel', 'expense_notes.report.export', 'expense_notes.pdf.bulk_export'],
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: expenseExportInput,
    preview: async (input) => preview('Export expenses', 'The expense export will be generated by the backend after confirmation.', {
      format: input.format,
      selectedCount: input.ids?.length ?? 0,
      hasFilters: Object.keys(input.filters ?? {}).length > 0,
      includeReceipts: input.includeReceipts ?? false,
    }),
    execute: (input, context) => {
      const permission = input.format === 'excel'
        ? 'expense_notes.export.excel'
        : input.format === 'csv'
          ? 'expense_notes.report.export'
          : 'expense_notes.pdf.bulk_export';
      erpScope(context, permission, AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return expenseService.exportNotes(context.user, input).then((result) => ({
        fileName: result.fileName,
        contentType: result.contentType,
        sizeBytes: result.buffer.length,
        format: input.format,
        includeReceipts: input.includeReceipts ?? false,
      }));
    },
  },
  {
    name: 'delete_expense_attachment',
    description: 'Delete an expense receipt attachment when business rules allow it.',
    module: 'expenses',
    requiredPermission: 'expense_notes.update',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: expenseAttachmentInput,
    preview: async (input) => preview('Delete expense attachment', 'The attachment will be deleted after confirmation if the expense note is still editable.', input),
    execute: (input, context) => {
      erpScope(context, 'expense_notes.update', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return expenseService.deleteAttachment(context.user, input.attachmentId);
    },
  },
  {
    name: 'search_products',
    description: 'Search and list products or catalogue items.',
    module: 'catalogue',
    requiredPermission: 'products.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: searchListInput,
    execute: (input, context) => {
      erpScope(context, 'products.view');
      return productService.getProducts(input);
    },
  },
  {
    name: 'create_product',
    description: 'Create a product or catalogue item.',
    module: 'catalogue',
    requiredPermission: 'products.create',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: productInput,
    form: {
      title: text('Creer un produit', 'Create product', 'Ø§Ù†Ø´Ø§Ø¡ Ù…Ù†ØªØ¬'),
      description: text('Renseignez les informations produit avant la previsualisation.', 'Complete the product information before preview.', 'Ø§ÙƒÙ…Ù„ Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù…Ù†ØªØ¬ Ù‚Ø¨Ù„ Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø©.'),
      buildInitialValue: async () => ({
        taxRate: 20,
        isActive: true,
      }),
      fields: [
        { path: 'name', type: 'text', label: text('Nom', 'Name', 'Ø§Ù„Ø§Ø³Ù…'), required: true },
        { path: 'description', type: 'textarea', label: text('Description', 'Description', 'Ø§Ù„ÙˆØµÙ') },
        { path: 'unit', type: 'text', label: text('Unite', 'Unit', 'Ø§Ù„ÙˆØ­Ø¯Ø©') },
        { path: 'unitPrice', type: 'currency', label: text('Prix unitaire', 'Unit price', 'Ø³Ø¹Ø± Ø§Ù„ÙˆØ­Ø¯Ø©'), required: true },
        { path: 'taxRate', type: 'number', label: text('TVA %', 'VAT %', 'Ù†Ø³Ø¨Ø© Ø§Ù„Ø¶Ø±ÙŠØ¨Ø© %'), required: true },
        { path: 'isActive', type: 'boolean', label: text('Actif', 'Active', 'Ù†Ø´Ø·') },
      ],
    },
    preview: async (input) => preview('Create product', 'A new product will be created after confirmation.', input),
    execute: (input, context) => {
      erpScope(context, 'products.create', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return productService.createProduct(input);
    },
  },
  {
    name: 'update_product',
    description: 'Update a product or catalogue item.',
    module: 'catalogue',
    requiredPermission: 'products.update',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: productUpdateInput,
    form: {
      title: text('Modifier un produit', 'Update product', 'ØªØ¹Ø¯ÙŠÙ„ Ù…Ù†ØªØ¬'),
      description: text('Ajustez les informations produit avant la previsualisation.', 'Adjust the product information before preview.', 'Ø¹Ø¯Ù‘Ù„ Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù…Ù†ØªØ¬ Ù‚Ø¨Ù„ Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø©.'),
      buildInitialValue: async (partialInput) => {
        if (typeof partialInput.id !== 'string') return {};
        const result = await productService.getProducts({ search: partialInput.id, limit: '50' });
        const product = result.data.find((entry) => entry.id === partialInput.id);
        return product
          ? {
              id: product.id,
              name: product.name,
              description: product.description ?? '',
              unit: product.unit ?? '',
              unitPrice: Number(product.unitPrice),
              taxRate: Number(product.taxRate ?? 0),
              isActive: product.isActive,
            }
          : {};
      },
      fields: [
        { path: 'id', type: 'entity', entityType: 'product', label: text('Produit', 'Product', 'Ø§Ù„Ù…Ù†ØªØ¬'), required: true, readOnly: true },
        { path: 'name', type: 'text', label: text('Nom', 'Name', 'Ø§Ù„Ø§Ø³Ù…') },
        { path: 'description', type: 'textarea', label: text('Description', 'Description', 'Ø§Ù„ÙˆØµÙ') },
        { path: 'unit', type: 'text', label: text('Unite', 'Unit', 'Ø§Ù„ÙˆØ­Ø¯Ø©') },
        { path: 'unitPrice', type: 'currency', label: text('Prix unitaire', 'Unit price', 'Ø³Ø¹Ø± Ø§Ù„ÙˆØ­Ø¯Ø©') },
        { path: 'taxRate', type: 'number', label: text('TVA %', 'VAT %', 'Ù†Ø³Ø¨Ø© Ø§Ù„Ø¶Ø±ÙŠØ¨Ø© %') },
        { path: 'isActive', type: 'boolean', label: text('Actif', 'Active', 'Ù†Ø´Ø·') },
      ],
    },
    preview: async (input) => preview('Update product', 'The product will be updated after confirmation.', input),
    execute: ({ id, ...data }, context) => {
      erpScope(context, 'products.update', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return productService.updateProduct(id, data);
    },
  },
  {
    name: 'search_recurring_plans',
    description: 'Search and list recurring billing plans.',
    module: 'recurring',
    requiredPermission: 'recurring.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: recurringQueryInput,
    execute: (input, context) => recurringService.list(context.user.id, erpScope(context, 'recurring.view'), input),
  },
  {
    name: 'get_recurring_plan_details',
    description: 'Get recurring billing plan details.',
    module: 'recurring',
    requiredPermission: 'recurring.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: entityIdInput,
    execute: (input, context) => recurringService.getById(input.id, context.user.id, erpScope(context, 'recurring.view')),
  },
  {
    name: 'create_recurring_plan',
    description: 'Create a recurring billing plan.',
    module: 'recurring',
    requiredPermission: 'recurring.create',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: recurringCreateInput,
    form: {
      title: text('Creer un plan recurrent', 'Create recurring plan', 'Ø§Ù†Ø´Ø§Ø¡ Ø®Ø·Ø© Ù…ØªÙƒØ±Ø±Ø©'),
      description: text('Definissez le plan recurrent avant la previsualisation.', 'Define the recurring plan before preview.', 'Ø­Ø¯Ø¯ Ø§Ù„Ø®Ø·Ø© Ø§Ù„Ù…ØªÙƒØ±Ø±Ø© Ù‚Ø¨Ù„ Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø©.'),
      buildInitialValue: async () => ({
        startDate: new Date().toISOString().slice(0, 10),
        frequency: 'MONTHLY',
        intervalCount: 1,
        dueDays: 30,
        autoSend: false,
        currency: 'MAD',
        discount: 0,
        items: [],
      }),
      fields: [
        { path: 'customerId', type: 'entity', entityType: 'customer', label: text('Client', 'Customer', 'Ø§Ù„Ø¹Ù…ÙŠÙ„'), required: true, resolveDisplayValue: resolveCustomerDisplayValue },
        { path: 'name', type: 'text', label: text('Nom du plan', 'Plan name', 'Ø§Ø³Ù… Ø§Ù„Ø®Ø·Ø©'), required: true },
        { path: 'frequency', type: 'select', label: text('Frequence', 'Frequency', 'Ø§Ù„ØªÙƒØ±Ø§Ø±'), required: true, options: [...recurringFrequencyOptions] },
        { path: 'intervalCount', type: 'number', label: text('Intervalle', 'Interval count', 'Ø¹Ø¯Ø¯ Ø§Ù„ÙØªØ±Ø§Øª'), required: true },
        { path: 'startDate', type: 'date', label: text('Date de debut', 'Start date', 'ØªØ§Ø±ÙŠØ® Ø§Ù„Ø¨Ø¯Ø¡'), required: true },
        { path: 'endDate', type: 'date', label: text('Date de fin', 'End date', 'ØªØ§Ø±ÙŠØ® Ø§Ù„Ø§Ù†ØªÙ‡Ø§Ø¡') },
        { path: 'dueDays', type: 'number', label: text('Delai de paiement', 'Due days', 'Ù…Ù‡Ù„Ø© Ø§Ù„Ø³Ø¯Ø§Ø¯'), required: true },
        { path: 'autoSend', type: 'boolean', label: text('Envoi automatique', 'Auto send', 'Ø§Ø±Ø³Ø§Ù„ ØªÙ„Ù‚Ø§Ø¦ÙŠ') },
        { path: 'currency', type: 'select', label: text('Devise', 'Currency', 'Ø§Ù„Ø¹Ù…Ù„Ø©'), required: true, options: currencyOptions() },
        { path: 'discount', type: 'currency', label: text('Remise', 'Discount', 'Ø§Ù„Ø®ØµÙ…') },
        { path: 'notes', type: 'textarea', label: text('Notes', 'Notes', 'Ù…Ù„Ø§Ø­Ø¸Ø§Øª') },
        { path: 'terms', type: 'textarea', label: text('Conditions', 'Terms', 'Ø§Ù„Ø´Ø±ÙˆØ·') },
        { path: 'items', type: 'array', label: text('Lignes', 'Items', 'Ø§Ù„Ø¨Ù†ÙˆØ¯'), required: true, minItems: 1, itemFields: [...invoiceLineItemFields] },
      ],
    },
    preview: async (input) => preview('Create recurring plan', 'A recurring billing plan will be created after confirmation.', input),
    execute: (input, context) => recurringService.create(context.user, erpScope(context, 'recurring.create', AI_ASSISTANT_PERMISSIONS.useWriteTools), input),
  },
  {
    name: 'update_recurring_plan',
    description: 'Update a recurring billing plan.',
    module: 'recurring',
    requiredPermission: 'recurring.update',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: recurringUpdateInput,
    form: {
      title: text('Modifier un plan recurrent', 'Update recurring plan', 'ØªØ¹Ø¯ÙŠÙ„ Ø®Ø·Ø© Ù…ØªÙƒØ±Ø±Ø©'),
      description: text('Ajustez le plan recurrent avant la previsualisation.', 'Adjust the recurring plan before preview.', 'Ø¹Ø¯Ù‘Ù„ Ø§Ù„Ø®Ø·Ø© Ø§Ù„Ù…ØªÙƒØ±Ø±Ø© Ù‚Ø¨Ù„ Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø©.'),
      buildInitialValue: async (partialInput, context) => {
        if (typeof partialInput.id !== 'string') return {};
        const plan = await recurringService.getById(partialInput.id, context.user.id, erpScope(context, 'recurring.view'));
        return {
          id: plan.id,
          customerId: plan.customerId,
          name: plan.name,
          frequency: plan.frequency,
          intervalCount: Number(plan.intervalCount),
          startDate: new Date(plan.startDate).toISOString().slice(0, 10),
          endDate: plan.endDate ? new Date(plan.endDate).toISOString().slice(0, 10) : '',
          dueDays: Number(plan.dueDays),
          autoSend: plan.autoSend,
          currency: plan.currency,
          discount: Number(plan.discount ?? 0),
          notes: plan.notes ?? '',
          terms: plan.terms ?? '',
          items: (plan.items ?? []).map((item) => ({
            description: item.description,
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice),
            taxRate: Number(item.taxRate ?? 0),
            unit: item.unit ?? '',
          })),
        };
      },
      fields: [
        { path: 'id', type: 'text', label: text('Plan', 'Plan', 'Ø§Ù„Ø®Ø·Ø©'), required: true, hidden: true },
        { path: 'customerId', type: 'entity', entityType: 'customer', label: text('Client', 'Customer', 'Ø§Ù„Ø¹Ù…ÙŠÙ„'), resolveDisplayValue: resolveCustomerDisplayValue },
        { path: 'name', type: 'text', label: text('Nom du plan', 'Plan name', 'Ø§Ø³Ù… Ø§Ù„Ø®Ø·Ø©') },
        { path: 'frequency', type: 'select', label: text('Frequence', 'Frequency', 'Ø§Ù„ØªÙƒØ±Ø§Ø±'), options: [...recurringFrequencyOptions] },
        { path: 'intervalCount', type: 'number', label: text('Intervalle', 'Interval count', 'Ø¹Ø¯Ø¯ Ø§Ù„ÙØªØ±Ø§Øª') },
        { path: 'startDate', type: 'date', label: text('Date de debut', 'Start date', 'ØªØ§Ø±ÙŠØ® Ø§Ù„Ø¨Ø¯Ø¡') },
        { path: 'endDate', type: 'date', label: text('Date de fin', 'End date', 'ØªØ§Ø±ÙŠØ® Ø§Ù„Ø§Ù†ØªÙ‡Ø§Ø¡') },
        { path: 'dueDays', type: 'number', label: text('Delai de paiement', 'Due days', 'Ù…Ù‡Ù„Ø© Ø§Ù„Ø³Ø¯Ø§Ø¯') },
        { path: 'autoSend', type: 'boolean', label: text('Envoi automatique', 'Auto send', 'Ø§Ø±Ø³Ø§Ù„ ØªÙ„Ù‚Ø§Ø¦ÙŠ') },
        { path: 'currency', type: 'select', label: text('Devise', 'Currency', 'Ø§Ù„Ø¹Ù…Ù„Ø©'), options: currencyOptions() },
        { path: 'discount', type: 'currency', label: text('Remise', 'Discount', 'Ø§Ù„Ø®ØµÙ…') },
        { path: 'notes', type: 'textarea', label: text('Notes', 'Notes', 'Ù…Ù„Ø§Ø­Ø¸Ø§Øª') },
        { path: 'terms', type: 'textarea', label: text('Conditions', 'Terms', 'Ø§Ù„Ø´Ø±ÙˆØ·') },
        { path: 'items', type: 'array', label: text('Lignes', 'Items', 'Ø§Ù„Ø¨Ù†ÙˆØ¯'), itemFields: [...invoiceLineItemFields] },
      ],
    },
    preview: async (input) => preview('Update recurring plan', 'The recurring billing plan will be updated after confirmation.', input),
    execute: ({ id, ...data }, context) => recurringService.update(id, context.user, erpScope(context, 'recurring.update', AI_ASSISTANT_PERMISSIONS.useWriteTools), data),
  },
  {
    name: 'change_recurring_plan_status',
    description: 'Change recurring billing plan status.',
    module: 'recurring',
    requiredPermission: 'recurring.update',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: recurringStatusInput,
    preview: async (input) => preview('Change recurring plan status', 'The recurring plan status will be changed after confirmation.', input),
    execute: (input, context) => recurringService.changeStatus(input.id, context.user.id, erpScope(context, 'recurring.update', AI_ASSISTANT_PERMISSIONS.useWriteTools), input.status),
  },
  {
    name: 'run_recurring_plan_now',
    description: 'Run a recurring billing plan immediately when business rules allow it.',
    module: 'recurring',
    requiredPermission: 'recurring.run',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: entityIdInput,
    preview: async (input) => preview('Run recurring plan now', 'The recurring plan will generate its due invoice immediately after confirmation.', input),
    execute: (input, context) => recurringService.runNow(input.id, context.user, erpScope(context, 'recurring.run', AI_ASSISTANT_PERMISSIONS.useWriteTools)),
  },
  {
    name: 'list_reminders',
    description: 'Search and list invoice reminders.',
    module: 'reminders',
    requiredPermission: 'reminders.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: reminderQueryInput,
    execute: (input, context) => {
      erpScope(context, 'reminders.view');
      return reminderService.getReminders(input);
    },
  },
  {
    name: 'create_reminder',
    description: 'Create a payment reminder using the existing reminder workflow.',
    module: 'reminders',
    requiredPermission: 'reminders.create',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: reminderCreateInput,
    form: {
      title: text('Creer un rappel', 'Create reminder', 'Ø§Ù†Ø´Ø§Ø¡ ØªØ°ÙƒÙŠØ±'),
      description: text('Preparez le rappel avant la previsualisation.', 'Prepare the reminder before preview.', 'Ø­Ø¶Ù‘Ø± Ø§Ù„ØªØ°ÙƒÙŠØ± Ù‚Ø¨Ù„ Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø©.'),
      buildInitialValue: async () => ({
        type: 'MANUAL',
        sendEmail: true,
      }),
      fields: [
        { path: 'invoiceId', type: 'entity', entityType: 'invoice', label: text('Facture', 'Invoice', 'Ø§Ù„ÙØ§ØªÙˆØ±Ø©'), required: true, readOnly: true, resolveDisplayValue: resolveInvoiceDisplayValue },
        { path: 'type', type: 'select', label: text('Type', 'Type', 'Ø§Ù„Ù†ÙˆØ¹'), required: true, options: [...reminderTypeOptions] },
        { path: 'recipientEmail', type: 'text', label: text('Destinataire', 'Recipient email', 'Ø§Ù„Ø¨Ø±ÙŠØ¯ Ø§Ù„Ù…Ø³ØªÙ„Ù…') },
        { path: 'subject', type: 'text', label: text('Sujet', 'Subject', 'Ø§Ù„Ù…ÙˆØ¶ÙˆØ¹') },
        { path: 'body', type: 'textarea', label: text('Message', 'Message', 'Ø§Ù„Ø±Ø³Ø§Ù„Ø©') },
        { path: 'sendEmail', type: 'boolean', label: text('Envoyer l email', 'Send email', 'Ø§Ø±Ø³Ù„ Ø§Ù„Ø¨Ø±ÙŠØ¯') },
      ],
    },
    preview: async (input) => preview('Create reminder', 'The reminder will be created and optionally sent after confirmation.', input),
    execute: (input, context) => {
      erpScope(context, 'reminders.create', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return reminderService.createReminder(context.user.id, input);
    },
  },
  {
    name: 'run_due_reminders',
    description: 'Generate automatic reminder drafts for due invoices.',
    module: 'reminders',
    requiredPermission: 'reminders.manage',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: z.object({}).strict(),
    preview: async () => preview('Run due reminders', 'Automatic reminder drafts will be generated for due invoices after confirmation.', {}),
    execute: (_input, context) => {
      erpScope(context, 'reminders.manage', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return reminderService.createAutomaticReminderDrafts();
    },
  },
  {
    name: 'list_users',
    description: 'List ERP users.',
    module: 'users',
    requiredPermission: 'users.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: searchListInput.extend({ role: z.nativeEnum(Role).optional(), isActive: z.boolean().optional() }).strict(),
    execute: (input, context) => {
      erpScope(context, 'users.view');
      return userService.getUsers(input);
    },
  },
  {
    name: 'create_user',
    description: 'Create an ERP user.',
    module: 'users',
    requiredPermission: 'users.create',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: userCreateInput,
    form: {
      title: text('Creer un utilisateur', 'Create user', 'Ø§Ù†Ø´Ø§Ø¡ Ù…Ø³ØªØ®Ø¯Ù…'),
      description: text('Completez les informations utilisateur avant la previsualisation.', 'Complete the user information before preview.', 'Ø§ÙƒÙ…Ù„ Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… Ù‚Ø¨Ù„ Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø©.'),
      buildInitialValue: async () => ({
        role: 'EMPLOYEE',
        isActive: true,
      }),
      fields: [
        { path: 'name', type: 'text', label: text('Nom', 'Name', 'Ø§Ù„Ø§Ø³Ù…'), required: true },
        { path: 'email', type: 'text', label: text('Email', 'Email', 'Ø§Ù„Ø¨Ø±ÙŠØ¯ Ø§Ù„Ø§Ù„ÙƒØªØ±ÙˆÙ†ÙŠ'), required: true },
        { path: 'password', type: 'text', label: text('Mot de passe', 'Password', 'ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ±'), required: true },
        { path: 'role', type: 'select', label: text('Role', 'Role', 'Ø§Ù„Ø¯ÙˆØ±'), required: true, options: [...roleOptions] },
        { path: 'isActive', type: 'boolean', label: text('Actif', 'Active', 'Ù†Ø´Ø·') },
      ],
    },
    preview: async (input) => preview('Create user', 'A new ERP user will be created after confirmation.', { ...input, password: '********' }),
    execute: (input, context) => {
      erpScope(context, 'users.create', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return userService.createUser(input);
    },
  },
  {
    name: 'update_user',
    description: 'Update an ERP user.',
    module: 'users',
    requiredPermission: 'users.update',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: userUpdateInput,
    form: {
      title: text('Modifier un utilisateur', 'Update user', 'ØªØ¹Ø¯ÙŠÙ„ Ù…Ø³ØªØ®Ø¯Ù…'),
      description: text('Ajustez les champs utilisateur avant la previsualisation.', 'Adjust the user fields before preview.', 'Ø¹Ø¯Ù‘Ù„ Ø­Ù‚ÙˆÙ„ Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… Ù‚Ø¨Ù„ Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø©.'),
      buildInitialValue: async (partialInput) => {
        if (typeof partialInput.id !== 'string') return {};
        const users = await userService.getUsers({ page: '1', limit: '50' });
        const user = users.data.find((entry) => entry.id === partialInput.id);
        return user
          ? {
              id: user.id,
              name: user.name,
              email: user.email,
              role: user.role,
              isActive: user.isActive,
            }
          : {};
      },
      fields: [
        { path: 'id', type: 'entity', entityType: 'user', label: text('Utilisateur', 'User', 'Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…'), required: true, readOnly: true, resolveDisplayValue: resolveUserDisplayValue },
        { path: 'name', type: 'text', label: text('Nom', 'Name', 'Ø§Ù„Ø§Ø³Ù…') },
        { path: 'email', type: 'text', label: text('Email', 'Email', 'Ø§Ù„Ø¨Ø±ÙŠØ¯ Ø§Ù„Ø§Ù„ÙƒØªØ±ÙˆÙ†ÙŠ') },
        { path: 'password', type: 'text', label: text('Nouveau mot de passe', 'New password', 'ÙƒÙ„Ù…Ø© Ù…Ø±ÙˆØ± Ø¬Ø¯ÙŠØ¯Ø©') },
        { path: 'role', type: 'select', label: text('Role', 'Role', 'Ø§Ù„Ø¯ÙˆØ±'), options: [...roleOptions] },
        { path: 'isActive', type: 'boolean', label: text('Actif', 'Active', 'Ù†Ø´Ø·') },
      ],
    },
    preview: async (input) => preview('Update user', 'The ERP user will be updated after confirmation.', { ...input, password: input.password ? '********' : undefined }),
    execute: ({ id, ...data }, context) => {
      erpScope(context, 'users.update', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return userService.updateUser(id, context.user.id, data);
    },
  },
  {
    name: 'list_roles',
    description: 'List roles.',
    module: 'roles',
    requiredPermission: 'roles.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: z.object({}).strict(),
    execute: (_input, context) => {
      erpScope(context, 'roles.view');
      return rbacService.listRoles();
    },
  },
  {
    name: 'create_role',
    description: 'Create a role.',
    module: 'roles',
    requiredPermission: 'roles.create',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: roleInput,
    form: {
      title: text('Creer un role', 'Create role', 'Ø§Ù†Ø´Ø§Ø¡ Ø¯ÙˆØ±'),
      description: text('Definissez le role avant la previsualisation.', 'Define the role before preview.', 'Ø­Ø¯Ø¯ Ø§Ù„Ø¯ÙˆØ± Ù‚Ø¨Ù„ Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø©.'),
      fields: [
        { path: 'name', type: 'text', label: text('Nom du role', 'Role name', 'Ø§Ø³Ù… Ø§Ù„Ø¯ÙˆØ±'), required: true },
        { path: 'description', type: 'textarea', label: text('Description', 'Description', 'Ø§Ù„ÙˆØµÙ') },
      ],
    },
    preview: async (input) => preview('Create role', 'A new role will be created after confirmation.', input),
    execute: (input, context) => {
      erpScope(context, 'roles.create', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return rbacService.createRole(input);
    },
  },
  {
    name: 'update_role',
    description: 'Update a role.',
    module: 'roles',
    requiredPermission: 'roles.update',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: roleUpdateInput,
    form: {
      title: text('Modifier un role', 'Update role', 'ØªØ¹Ø¯ÙŠÙ„ Ø¯ÙˆØ±'),
      description: text('Ajustez les informations du role avant la previsualisation.', 'Adjust the role information before preview.', 'Ø¹Ø¯Ù‘Ù„ Ù…Ø¹Ù„ÙˆÙ…Ø§Øª Ø§Ù„Ø¯ÙˆØ± Ù‚Ø¨Ù„ Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø©.'),
      buildInitialValue: async (partialInput) => {
        if (typeof partialInput.id !== 'string') return {};
        const roles = await rbacService.listRoles();
        const role = roles.find((entry) => entry.id === partialInput.id);
        return role ? { id: role.id, name: role.name, description: role.description ?? '' } : {};
      },
      fields: [
        { path: 'id', type: 'entity', entityType: 'role', label: text('Role', 'Role', 'Ø§Ù„Ø¯ÙˆØ±'), required: true, readOnly: true, resolveDisplayValue: resolveRoleDisplayValue },
        { path: 'name', type: 'text', label: text('Nom du role', 'Role name', 'Ø§Ø³Ù… Ø§Ù„Ø¯ÙˆØ±') },
        { path: 'description', type: 'textarea', label: text('Description', 'Description', 'Ø§Ù„ÙˆØµÙ') },
      ],
    },
    preview: async (input) => preview('Update role', 'The role will be updated after confirmation.', input),
    execute: ({ id, ...data }, context) => {
      erpScope(context, 'roles.update', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return rbacService.updateRole(id, data);
    },
  },
  {
    name: 'delete_role',
    description: 'Delete a role when allowed.',
    module: 'roles',
    requiredPermission: 'roles.delete',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: entityIdInput,
    preview: async (input) => preview('Delete role', 'The role will be deleted after confirmation if business rules allow it.', input),
    execute: (input, context) => {
      erpScope(context, 'roles.delete', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return rbacService.deleteRole(input.id);
    },
  },
  {
    name: 'list_permissions',
    description: 'List permissions.',
    module: 'permissions',
    requiredPermission: 'permissions.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: z.object({}).strict(),
    execute: (_input, context) => {
      erpScope(context, 'permissions.view');
      return rbacService.listPermissions();
    },
  },
  {
    name: 'create_permission',
    description: 'Create a permission entry when the RBAC system allows it.',
    module: 'permissions',
    requiredPermission: 'permissions.assign',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: permissionCreateInput,
    form: {
      title: text('Creer une permission', 'Create permission', 'Ø§Ù†Ø´Ø§Ø¡ ØµÙ„Ø§Ø­ÙŠØ©'),
      description: text('Renseignez la cle et la description avant la previsualisation.', 'Provide the permission key and description before preview.', 'Ø§Ø¯Ø®Ù„ Ù…ÙØªØ§Ø­ Ø§Ù„ØµÙ„Ø§Ø­ÙŠØ© ÙˆØ§Ù„ÙˆØµÙ Ù‚Ø¨Ù„ Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø©.'),
      fields: [
        { path: 'key', type: 'text', label: text('Cle permission', 'Permission key', 'Ù…ÙØªØ§Ø­ Ø§Ù„ØµÙ„Ø§Ø­ÙŠØ©'), required: true },
        { path: 'description', type: 'textarea', label: text('Description', 'Description', 'Ø§Ù„ÙˆØµÙ') },
      ],
    },
    preview: async (input) => preview('Create permission', 'The permission will be created after confirmation.', input),
    execute: (input, context) => {
      erpScope(context, 'permissions.assign', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return rbacService.createPermission(input);
    },
  },
  {
    name: 'delete_permission',
    description: 'Delete a permission entry when the RBAC system allows it.',
    module: 'permissions',
    requiredPermission: 'permissions.assign',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: entityIdInput,
    preview: async (input) => preview('Delete permission', 'The permission will be deleted after confirmation.', input),
    execute: (input, context) => {
      erpScope(context, 'permissions.assign', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return rbacService.deletePermission(input.id);
    },
  },
  {
    name: 'assign_role_permissions',
    description: 'Assign permissions and scopes to a role.',
    module: 'permissions',
    requiredPermission: 'permissions.assign',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: assignPermissionsInput,
    form: {
      title: text('Affecter permissions role', 'Assign role permissions', 'ØªØ¹ÙŠÙŠÙ† ØµÙ„Ø§Ø­ÙŠØ§Øª Ø§Ù„Ø¯ÙˆØ±'),
      description: text('Remplacez l ensemble des permissions du role via une previsualisation securisee.', 'Replace the role permission set through a secure preview.', 'Ø§Ø³ØªØ¨Ø¯Ù„ Ù…Ø¬Ù…ÙˆØ¹Ø© ØµÙ„Ø§Ø­ÙŠØ§Øª Ø§Ù„Ø¯ÙˆØ± Ø¹Ø¨Ø± Ù…Ø¹Ø§ÙŠÙ†Ø© Ø¢Ù…Ù†Ø©.'),
      fields: [
        { path: 'roleId', type: 'entity', entityType: 'role', label: text('Role', 'Role', 'Ø§Ù„Ø¯ÙˆØ±'), required: true, resolveDisplayValue: resolveRoleDisplayValue },
        { path: 'permissions', type: 'array', label: text('Permissions', 'Permissions', 'Ø§Ù„ØµÙ„Ø§Ø­ÙŠØ§Øª'), required: true, minItems: 1, itemFields: [
          { path: 'permissionId', type: 'entity', entityType: 'permission', label: text('Permission', 'Permission', 'Ø§Ù„ØµÙ„Ø§Ø­ÙŠØ©'), required: true, resolveDisplayValue: resolvePermissionDisplayValue },
          { path: 'scope', type: 'select', label: text('Scope', 'Scope', 'Ø§Ù„Ù†Ø·Ø§Ù‚'), required: true, options: [...permissionScopeOptions] },
        ] },
      ],
    },
    preview: async (input) => preview('Assign role permissions', 'The role permission set will be replaced after confirmation.', { roleId: input.roleId, permissionCount: input.permissions.length }),
    execute: (input, context) => {
      erpScope(context, 'permissions.assign', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return rbacService.assignPermissions(input.roleId, input.permissions);
    },
  },
  {
    name: 'assign_user_role',
    description: 'Assign a role to a user.',
    module: 'permissions',
    requiredPermission: 'permissions.assign',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: assignRoleInput,
    form: {
      title: text('Affecter un role utilisateur', 'Assign user role', 'ØªØ¹ÙŠÙŠÙ† Ø¯ÙˆØ± Ù„Ù…Ø³ØªØ®Ø¯Ù…'),
      description: text('Choisissez l utilisateur et le role avant la previsualisation.', 'Choose the user and role before preview.', 'Ø§Ø®ØªØ± Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… ÙˆØ§Ù„Ø¯ÙˆØ± Ù‚Ø¨Ù„ Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø©.'),
      buildInitialValue: async (partialInput) => ({ userId: partialInput.userId, roleId: partialInput.roleId }),
      fields: [
        { path: 'userId', type: 'entity', entityType: 'user', label: text('Utilisateur', 'User', 'Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…'), required: true, resolveDisplayValue: resolveUserDisplayValue },
        { path: 'roleId', type: 'entity', entityType: 'role', label: text('Role', 'Role', 'Ø§Ù„Ø¯ÙˆØ±'), required: true, resolveDisplayValue: resolveRoleDisplayValue },
      ],
    },
    preview: async (input) => preview('Assign user role', 'The user role will be changed after confirmation.', input),
    execute: (input, context) => {
      erpScope(context, 'permissions.assign', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return rbacService.assignUserRole(input.userId, input.roleId);
    },
  },
  {
    name: 'assign_user_clients',
    description: 'Assign selected clients to a user.',
    module: 'permissions',
    requiredPermission: 'permissions.assign',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: assignClientsInput,
    form: {
      title: text('Affecter clients utilisateur', 'Assign user clients', 'ØªØ¹ÙŠÙŠÙ† Ø¹Ù…Ù„Ø§Ø¡ Ù„Ù„Ù…Ø³ØªØ®Ø¯Ù…'),
      description: text('Remplacez la liste des clients autorises via une previsualisation securisee.', 'Replace the authorized client list through a secure preview.', 'Ø§Ø³ØªØ¨Ø¯Ù„ Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ø¹Ù…Ù„Ø§Ø¡ Ø§Ù„Ù…Ø³Ù…ÙˆØ­ÙŠÙ† Ø¹Ø¨Ø± Ù…Ø¹Ø§ÙŠÙ†Ø© Ø¢Ù…Ù†Ø©.'),
      fields: [
        { path: 'userId', type: 'entity', entityType: 'user', label: text('Utilisateur', 'User', 'Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…'), required: true, resolveDisplayValue: resolveUserDisplayValue },
        { path: 'clientIds', type: 'array', label: text('Clients', 'Clients', 'Ø§Ù„Ø¹Ù…Ù„Ø§Ø¡'), required: true, minItems: 1, itemFields: [
          { path: 'value', type: 'entity', entityType: 'customer', label: text('Client', 'Client', 'Ø§Ù„Ø¹Ù…ÙŠÙ„'), required: true, resolveDisplayValue: resolveCustomerDisplayValue },
        ] },
      ],
    },
    preview: async (input) => preview('Assign user clients', 'The user client assignments will be replaced after confirmation.', { userId: input.userId, clientCount: input.clientIds.length }),
    execute: (input, context) => {
      erpScope(context, 'permissions.assign', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return rbacService.assignUserClients(input.userId, input.clientIds);
    },
  },
  {
    name: 'get_audit_logs',
    description: 'Search enterprise audit logs.',
    module: 'audit',
    requiredPermission: 'audit_logs.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: auditListInput,
    execute: (input, context) => {
      erpScope(context, 'audit_logs.view');
      return auditService.list(input);
    },
  },
  {
    name: 'get_entity_audit_timeline',
    description: 'Get the audit timeline for a specific entity.',
    module: 'audit',
    requiredPermission: 'audit_logs.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: auditTimelineInput,
    execute: (input, context) => {
      erpScope(context, 'audit_logs.view');
      return auditService.timeline(input.entity, input.entityId, input.page, input.limit);
    },
  },
  {
    name: 'get_receivables_aging_report',
    description: 'Get receivables aging report.',
    module: 'reports',
    requiredPermission: 'reports.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: z.object({}).strict(),
    execute: (_input, context) => {
      erpScope(context, 'reports.view');
      return reportService.getReceivablesAging();
    },
  },
  {
    name: 'get_tax_summary_report',
    description: 'Get VAT/tax summary report.',
    module: 'vat',
    requiredPermission: 'reports.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: z.object({ dateFrom: optionalDate, dateTo: optionalDate }).strict(),
    execute: (input, context) => {
      erpScope(context, 'reports.view');
      return reportService.getTaxSummary(input);
    },
  },
  {
    name: 'get_dashboard_stats',
    description: 'Get dashboard statistics.',
    module: 'dashboard',
    requiredPermission: 'invoices.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: z.object({
      period: z.enum(['this_month', 'last_3_months', 'last_6_months', 'this_year', 'custom']).optional(),
      dateFrom: optionalDate,
      dateTo: optionalDate,
      months: z.enum(['6', '12']).optional(),
    }).strict(),
    execute: (input, context) => invoiceService.getDashboardStats(context.user.id, erpScope(context, 'invoices.view'), input),
  },
  {
    name: 'get_company_settings',
    description: 'Get company, VAT, signature and email settings.',
    module: 'settings',
    requiredPermission: 'settings.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: z.object({}).strict(),
    execute: (_input, context) => {
      erpScope(context, 'settings.view');
      return settingsService.getCompanySettings();
    },
  },
  {
    name: 'get_settings_email_status',
    description: 'Get backend email delivery configuration status.',
    module: 'settings',
    requiredPermission: 'settings.update',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: z.object({}).strict(),
    execute: async (_input, context) => {
      erpScope(context, 'settings.update');
      return settingsService.getEmailStatus();
    },
  },
  {
    name: 'get_settings_email_logs',
    description: 'Get recent backend email logs from company settings.',
    module: 'settings',
    requiredPermission: 'settings.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: z.object({}).strict(),
    execute: (_input, context) => {
      erpScope(context, 'settings.view');
      return settingsService.getRecentEmailLogs();
    },
  },
  {
    name: 'update_company_settings',
    description: 'Update company, VAT and billing settings.',
    module: 'settings',
    requiredPermission: 'settings.update',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: settingsInput,
    preview: async (input) => preview('Update company settings', 'Company settings will be updated after confirmation.', input),
    execute: (input, context) => {
      erpScope(context, 'settings.update', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return settingsService.updateCompanySettings(input);
    },
  },
  {
    name: 'delete_company_asset',
    description: 'Delete the configured company signature or stamp asset.',
    module: 'settings',
    requiredPermission: 'settings.update',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: settingsAssetInput,
    preview: async (input) => preview('Delete company asset', 'The selected company asset will be deleted after confirmation.', input),
    execute: (input, context) => {
      erpScope(context, 'settings.update', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return settingsService.deleteCompanyAsset(input.kind);
    },
  },
  {
    name: 'remove_company_asset_background',
    description: 'Remove the background from the configured company signature or stamp asset.',
    module: 'settings',
    requiredPermission: 'settings.update',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: settingsAssetInput,
    preview: async (input) => preview('Remove company asset background', 'The selected company asset will be cleaned up after confirmation.', input),
    execute: (input, context) => {
      erpScope(context, 'settings.update', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return settingsService.removeCompanyAssetBackground(input.kind);
    },
  },
  {
    name: 'send_test_email',
    description: 'Send a test email from the configured backend SMTP transport.',
    module: 'email',
    requiredPermission: 'settings.update',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: z.object({ recipientEmail: z.string().email().optional() }).strict(),
    preview: async (input) => preview('Send test email', 'A test email will be sent from the backend email configuration.', input),
    execute: (input, context) => {
      erpScope(context, 'settings.update', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return settingsService.sendTestEmail(context.user, input);
    },
  },
  {
    name: 'get_contract_email_history',
    description: 'Get contract email delivery history.',
    module: 'email',
    requiredPermission: 'contracts.email.history',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: entityIdInput,
    execute: (input, context) => contractService.getEmailHistory(input.id, context.user.id, erpScope(context, 'contracts.email.history')),
  },
  {
    name: 'list_contract_templates',
    description: 'List available contract templates.',
    module: 'contracts',
    requiredPermission: 'contract_templates.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: z.object({ includeInactive: z.boolean().optional().default(false) }).strict(),
    execute: (input, context) => {
      erpScope(context, 'contract_templates.view');
      return contractService.listTemplates(input.includeInactive);
    },
  },
];
