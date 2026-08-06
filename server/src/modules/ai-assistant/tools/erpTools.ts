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
import { reportService } from '@modules/report/report.service';
import { settingsService } from '@modules/settings/settings.service';
import { userService } from '@modules/user/user.service';
import { ApiError } from '@utils/ApiError';
import { AI_ASSISTANT_PERMISSIONS } from '../aiAssistant.permissions';
import type { AiTool, ToolContext, ToolPreview } from './toolTypes';

const uuid = z.string().uuid();
const limit = z.coerce.number().int().min(1).max(50).default(10);
const optionalPage = z.coerce.number().int().min(1).default(1).transform(String);
const optionalLimit = limit.transform(String);
const dateString = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date');
const optionalDate = dateString.optional();
const money = z.coerce.number().min(0);
const positiveMoney = z.coerce.number().positive();
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
  amount: money.optional(),
  currency,
  pricingType: z.nativeEnum(ContractPricingType).default(ContractPricingType.FIXED),
  unitRate: positiveMoney.optional(),
  estimatedQuantity: money.optional(),
  fixedAmount: positiveMoney.optional(),
  billingFrequency: z.nativeEnum(ContractBillingFrequency).default(ContractBillingFrequency.ONE_TIME),
  billingDay: z.coerce.number().int().min(1).max(31).optional().nullable(),
  billingStartDate: optionalDate,
  billingEndDate: optionalDate,
  minimumBillableUnits: money.optional(),
  includedUnits: money.optional(),
  overtimeRate: money.optional(),
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
const invoiceEmailInput = z.object({
  invoiceId: uuid,
  recipientEmail: z.string().email().optional(),
  subject: z.string().trim().min(3).max(255).optional(),
  message: z.string().trim().min(3).max(5000).optional(),
}).strict();
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

function preview(title: string, description: string, summary: Record<string, unknown>): ToolPreview {
  return { title, description, summary };
}

function binaryResult(fileName: string, buffer: Buffer) {
  return {
    fileName,
    size: buffer.length,
    generated: true,
  };
}

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
    requiredPermission: 'contracts.sign',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: entityIdInput,
    preview: async (input) => preview('Sign contract', 'The company signature and stamp will be applied to the contract after confirmation.', input),
    execute: (input, context) => contractService.signForCompany(input.id, context.user, erpScope(context, 'contracts.sign', AI_ASSISTANT_PERMISSIONS.useWriteTools)),
  },
  {
    name: 'revoke_contract_signature',
    description: 'Revoke a contract signature.',
    module: 'signature',
    requiredPermission: 'contracts.sign',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: contractRevokeSignatureInput,
    preview: async (input) => preview('Revoke contract signature', 'The contract signature will be revoked after confirmation.', input),
    execute: ({ id, ...data }, context) => contractService.revokeSignature(id, context.user, erpScope(context, 'contracts.sign', AI_ASSISTANT_PERMISSIONS.useWriteTools), data),
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
    description: 'Generate a contract PDF.',
    module: 'pdf',
    requiredPermission: 'contracts.pdf.download',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: entityIdInput.extend({ language: z.enum(['fr', 'en', 'ar']).optional() }).strict(),
    execute: async (input, context) => {
      const pdf = await contractService.downloadPdf(input.id, context.user.id, erpScope(context, 'contracts.pdf.download'), input.language);
      return binaryResult(pdf.fileName, pdf.buffer);
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
    name: 'get_invoice_details',
    description: 'Get invoice details.',
    module: 'invoices',
    requiredPermission: 'invoices.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: z.object({ invoiceId: uuid }).strict(),
    execute: (input, context) => invoiceService.getInvoiceById(input.invoiceId, context.user.id, erpScope(context, 'invoices.view')),
  },
  {
    name: 'create_invoice',
    description: 'Create an invoice.',
    module: 'invoices',
    requiredPermission: 'invoices.create',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: invoiceCreateInput,
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
    name: 'send_invoice_email',
    description: 'Send an invoice by email.',
    module: 'email',
    requiredPermission: 'invoices.send',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: invoiceEmailInput,
    preview: async (input) => preview('Send invoice email', 'The invoice PDF will be generated and emailed by the backend.', input),
    execute: ({ invoiceId, ...data }, context) => invoiceService.sendInvoiceEmail(invoiceId, context.user.id, erpScope(context, 'invoices.send', AI_ASSISTANT_PERMISSIONS.useWriteTools), data),
  },
  {
    name: 'generate_invoice_pdf',
    description: 'Prepare invoice PDF metadata and validate PDF access.',
    module: 'pdf',
    requiredPermission: 'invoices.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: z.object({ invoiceId: uuid }).strict(),
    execute: async (input, context) => {
      const invoice = await invoiceService.getInvoiceById(input.invoiceId, context.user.id, erpScope(context, 'invoices.view'));
      return {
        generated: true,
        fileName: `${invoice.invoiceNumber}.pdf`,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        downloadEndpoint: `/api/invoices/${invoice.id}/pdf`,
      };
    },
  },
  {
    name: 'record_invoice_payment',
    description: 'Record a payment for an invoice.',
    module: 'payments',
    requiredPermission: 'payments.create',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: invoicePaymentInput,
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
    name: 'create_quote',
    description: 'Create a quote/devis.',
    module: 'quotes',
    requiredPermission: 'devis.create',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: quoteCreateInput,
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
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: entityIdInput,
    preview: async (input) => preview('Convert quote to invoice', 'An invoice will be created from the quote after confirmation.', input),
    execute: (input, context) => devisService.convertToInvoice(input.id, context.user.id, erpScope(context, 'devis.convert', AI_ASSISTANT_PERMISSIONS.useWriteTools)),
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
    preview: async (input) => preview('Update credit note', 'The credit note will be updated after confirmation.', input),
    execute: ({ id, ...data }, context) => creditNoteService.update(id, context.user.id, erpScope(context, 'credit_notes.update', AI_ASSISTANT_PERMISSIONS.useWriteTools), data),
  },
  {
    name: 'delete_credit_note',
    description: 'Delete a credit note/avoir when allowed.',
    module: 'credit_notes',
    requiredPermission: 'credit_notes.delete',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: entityIdInput,
    preview: async (input) => preview('Delete credit note', 'The credit note will be deleted after confirmation if business rules allow it.', input),
    execute: (input, context) => creditNoteService.remove(input.id, context.user.id, erpScope(context, 'credit_notes.delete', AI_ASSISTANT_PERMISSIONS.useWriteTools)),
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
    description: 'Generate a credit note PDF.',
    module: 'pdf',
    requiredPermission: 'credit_notes.pdf.download',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: entityIdInput.extend({ language: z.enum(['fr', 'en', 'ar']).optional().default('fr') }).strict(),
    execute: async (input, context) => {
      const pdf = await creditNoteService.pdfBuffer(input.id, context.user.id, erpScope(context, 'credit_notes.pdf.download'), input.language);
      return binaryResult(pdf.fileName, pdf.buffer);
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
    description: 'Generate an expense note PDF.',
    module: 'pdf',
    requiredPermission: 'expense_notes.pdf.download',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: entityIdInput.extend({ language: z.enum(['en', 'fr', 'ar']).optional().default('fr') }).strict(),
    execute: async (input, context) => {
      const pdf = await expenseService.renderNotePdf(context.user, input.id, 'expense_notes.pdf.download', 'PDF_DOWNLOADED', input.language);
      return binaryResult(pdf.fileName, pdf.buffer);
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
    name: 'assign_role_permissions',
    description: 'Assign permissions and scopes to a role.',
    module: 'permissions',
    requiredPermission: 'permissions.assign',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: assignPermissionsInput,
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
];
