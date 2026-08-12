import crypto from 'crypto';
import {
  AiToolRiskLevel,
  ContractTimeEntryStatus,
  ContractStatus,
  ContractSignatureStatus,
} from '@prisma/client';
import { z } from 'zod';
import { authorizePermission, permissionScope } from '@modules/rbac/accessScope';
import { customerService } from '@modules/customer/customer.service';
import { contractService } from '@modules/contract/contract.service';
import { invoiceService } from '@modules/invoice/invoice.service';
import { auditService } from '@modules/audit/audit.service';
import { ApiError } from '@utils/ApiError';
import { AI_ASSISTANT_PERMISSIONS } from '../aiAssistant.permissions';
import type { AiLocalizedText, AiTool, ToolContext, ToolPreview } from './toolTypes';

const uuid = z.string().uuid();
const limit = z.coerce.number().int().min(1).max(25).default(10);
const optionalDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date').optional();
const optionalDateTime = z.string().datetime().optional().nullable();

const searchInput = z.object({
  query: z.string().trim().min(1).max(160),
  limit,
}).strict();

const contractIdInput = z.object({
  contractId: uuid,
}).strict();

const listTimesheetsInput = z.object({
  contractId: uuid,
  status: z.nativeEnum(ContractTimeEntryStatus).optional(),
  workDate: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date').optional(),
}).strict();

const createTimesheetInput = z.object({
  contractId: uuid,
  workDate: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date'),
  startTime: optionalDateTime,
  endTime: optionalDateTime,
  breakMinutes: z.coerce.number().int().min(0).max(1440).default(0),
  quantity: z.coerce.number().positive().optional(),
  activityType: z.string().trim().min(2).max(80).optional().nullable(),
  description: z.string().trim().min(2).max(2000),
  internalNote: z.string().trim().max(2000).optional().nullable(),
  billable: z.coerce.boolean().default(true),
  submit: z.coerce.boolean().default(false),
}).strict();

const timeEntryActionInput = z.object({
  contractId: uuid,
  timeEntryId: uuid,
  reason: z.string().trim().min(3).max(2000).optional(),
}).strict();

const timeEntryDetailsInput = z.object({
  contractId: uuid,
  timeEntryId: uuid,
}).strict();

const updateTimesheetInput = z.object({
  contractId: uuid,
  timeEntryId: uuid,
  workDate: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date').optional(),
  startTime: optionalDateTime,
  endTime: optionalDateTime,
  breakMinutes: z.coerce.number().int().min(0).max(1440).optional(),
  quantity: z.coerce.number().positive().optional(),
  activityType: z.string().trim().min(2).max(80).optional().nullable(),
  description: z.string().trim().min(2).max(2000).optional(),
  internalNote: z.string().trim().max(2000).optional().nullable(),
  billable: z.coerce.boolean().optional(),
}).strict();

const generateInvoiceInput = z.object({
  contractId: uuid,
  periodStart: optionalDate,
  periodEnd: optionalDate,
  milestoneId: uuid.optional(),
  scheduleItemId: uuid.optional(),
}).strict();

const invoiceIdInput = z.object({
  invoiceId: uuid,
}).strict();

const invoiceEmailInput = z.object({
  invoiceId: uuid,
  recipientEmail: z.string().email().optional(),
  subject: z.string().trim().min(2).max(255).optional(),
  message: z.string().trim().min(2).max(5000).optional(),
}).strict();

const auditSearchInput = z.object({
  search: z.string().trim().max(200).optional(),
  module: z.string().trim().max(80).optional(),
  entity: z.string().trim().max(120).optional(),
  action: z.string().trim().max(80).optional(),
  limit,
}).strict();

function ensureToolPermission(
  context: ToolContext,
  permission: string,
  assistantPermission: string = AI_ASSISTANT_PERMISSIONS.useReadTools
) {
  if (!context.user.permissions.includes(assistantPermission)) {
    throw ApiError.forbidden('You are not allowed to use this assistant action.');
  }
  const authorization = authorizePermission({
    userId: context.user.id,
    permissions: context.user.permissions,
    scopes: context.user.permissionScopes,
    permission,
  });
  if (!authorization.allowed) {
    throw ApiError.forbidden(friendlyPermissionDenied(permission));
  }
}

function contractScope(
  context: ToolContext,
  permission: string,
  assistantPermission: string = AI_ASSISTANT_PERMISSIONS.useReadTools
) {
  ensureToolPermission(context, permission, assistantPermission);
  return permissionScope(context.user.permissionScopes, permission);
}

function friendlyPermissionDenied(permission: string) {
  const resource = permission.split('.')[0] ?? 'resource';
  const labels: Record<string, string> = {
    clients: 'clients',
    contracts: 'contracts',
    customers: 'clients',
    invoices: 'invoices',
    payments: 'payments',
    credit_notes: 'credit notes',
    expense_notes: 'expense notes',
    audit_logs: 'audit logs',
  };
  return `You are not allowed to access ${labels[resource] ?? resource}.`;
}

function money(value: unknown) {
  return value == null ? null : Number(value);
}

function text(fr: string, en: string, ar: string): AiLocalizedText {
  return { fr, en, ar };
}

async function resolveContractDisplayValue(value: unknown, draft: Record<string, unknown>, context: ToolContext) {
  if (typeof draft.contractNumber === 'string' && draft.contractNumber.trim()) return draft.contractNumber.trim();
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const contract = await contractService.getById(value, context.user.id, permissionScope(context.user.permissionScopes, 'contracts.view'));
    return contract.contractNumber || contract.title || value;
  } catch {
    return value;
  }
}

async function resolveContractClientDisplayValue(value: unknown, draft: Record<string, unknown>, context: ToolContext) {
  if (typeof draft.clientName === 'string' && draft.clientName.trim()) return draft.clientName.trim();
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const customer = await customerService.getCustomerById(value, context.user.id, permissionScope(context.user.permissionScopes, 'clients.view'));
    return customer.company || customer.name || value;
  } catch {
    return value;
  }
}

function summarizeContract(contract: any) {
  return {
    id: contract.id,
    contractNumber: contract.contractNumber,
    title: contract.title,
    status: contract.status,
    signatureStatus: contract.signatureStatus,
    client: contract.client ? {
      id: contract.client.id,
      name: contract.client.company || contract.client.name,
      email: contract.client.email,
    } : null,
    pricingType: contract.pricingType,
    billingFrequency: contract.billingFrequency,
    unitRate: money(contract.unitRate),
    fixedAmount: money(contract.fixedAmount),
    currency: contract.currency,
    taxRate: money(contract.taxRate),
  };
}

function summarizeTimeEntry(entry: any) {
  return {
    id: entry.id,
    contractId: entry.contractId,
    workDate: entry.workDate,
    userId: entry.userId,
    employee: entry.user?.name,
    activityType: entry.activityType,
    description: entry.description,
    quantity: money(entry.quantity),
    durationMinutes: entry.durationMinutes,
    billableMinutes: entry.billableMinutes,
    calculatedAmount: money(entry.calculatedAmount),
    currency: entry.currency,
    status: entry.status,
    invoiceId: entry.invoiceId,
  };
}

function toDateOnly(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function defaultBillingPeriod(contract: any) {
  const start = contract.nextInvoiceDate ?? contract.billingStartDate ?? new Date();
  const startDate = start instanceof Date ? start : new Date(start);
  const periodStart = Number.isNaN(startDate.getTime()) ? new Date() : startDate;
  const frequency = String(contract.billingFrequency ?? '').toUpperCase();
  if (contract.billingEndDate) {
    const end = contract.billingEndDate instanceof Date ? contract.billingEndDate : new Date(contract.billingEndDate);
    if (!Number.isNaN(end.getTime()) && end < periodStart) return { periodStart, periodEnd: periodStart };
  }
  if (frequency.includes('ANNUAL')) return { periodStart, periodEnd: addDays(periodStart, 364) };
  if (frequency.includes('WEEK')) return { periodStart, periodEnd: addDays(periodStart, 6) };
  if (frequency.includes('DAILY')) return { periodStart, periodEnd: periodStart };
  if (frequency.includes('MONTH')) {
    const end = new Date(periodStart);
    end.setMonth(end.getMonth() + 1);
    end.setDate(end.getDate() - 1);
    return { periodStart, periodEnd: end };
  }
  return { periodStart, periodEnd: contract.billingEndDate ?? contract.endDate ?? periodStart };
}

function buildInvoicePreview(contract: any, input: { periodStart?: string; periodEnd?: string }) {
  const fallback = defaultBillingPeriod(contract);
  const periodStart = input.periodStart ? new Date(input.periodStart) : fallback.periodStart;
  const periodEnd = input.periodEnd ? new Date(input.periodEnd) : fallback.periodEnd;
  const ready = (contract.timeEntries ?? [])
    .filter((entry: any) => {
      const workDate = entry.workDate instanceof Date ? entry.workDate : new Date(String(entry.workDate));
      return entry.status === ContractTimeEntryStatus.APPROVED
        && !entry.invoiceId
        && entry.billable
        && !Number.isNaN(workDate.getTime())
        && workDate >= periodStart
        && workDate <= periodEnd;
    })
    .map(summarizeTimeEntry);
  const subtotal = ready.reduce((total: number, entry: any) => total + Number(entry.calculatedAmount ?? 0), 0);
  const taxRate = Number(contract.taxRate ?? 0);
  const taxAmount = Number((subtotal * taxRate / 100).toFixed(2));
  const total = Number((subtotal + taxAmount).toFixed(2));
  const billableMinutes = ready.reduce((total: number, entry: any) => total + Number(entry.billableMinutes ?? entry.durationMinutes ?? 0), 0);
  return {
    contract: summarizeContract(contract),
    client: contract.client ? {
      id: contract.client.id,
      name: contract.client.company || contract.client.name,
      email: contract.client.email,
    } : null,
    billingPeriod: {
      start: toDateOnly(periodStart),
      end: toDateOnly(periodEnd),
    },
    readyTimesheets: ready,
    approvedBillableTimesheetCount: ready.length,
    billableHours: Number((billableMinutes / 60).toFixed(2)),
    hourlyRate: money(contract.unitRate),
    discount: 0,
    subtotal,
    taxRate,
    taxAmount,
    estimatedTotal: total,
    currency: contract.currency,
  };
}

async function getContract(context: ToolContext, contractId: string, permission = 'contracts.view') {
  return contractService.getById(contractId, context.user.id, contractScope(context, permission));
}
function assertInvoiceReadyContract(contract: any) {
  const allowedStatus =
    contract.status === ContractStatus.ACTIVE ||
    contract.status === ContractStatus.SENT ||
    contract.status === ContractStatus.VIEWED;

  if (!allowedStatus) {
    throw ApiError.badRequest('Only active or sent contracts can be invoiced');
  }

  if (
    contract.currentVersion?.signatureStatus !==
    ContractSignatureStatus.COMPLETED
  ) {
    throw ApiError.badRequest('Contract signature workflow is incomplete');
  }
}
async function previewContractAction(context: ToolContext, contractId: string, title: string, description: string): Promise<ToolPreview> {
  const contract = await getContract(context, contractId);
  return {
    title,
    description,
    summary: summarizeContract(contract),
  };
}

export const aiTools: AiTool[] = [
  {
    name: 'search_clients',
    description: 'Search authorized clients by name, company or email.',
    module: 'clients',
    requiredPermission: 'clients.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: searchInput,
    execute: async (input, context) => {
      ensureToolPermission(context, 'clients.view');
      const result = await customerService.getCustomers(context.user.id, permissionScope(context.user.permissionScopes, 'clients.view'), {
        page: '1',
        limit: String(input.limit),
        search: input.query,
      } as any);
      return result.data.map((client: any) => ({
        id: client.id,
        name: client.company || client.name,
        email: client.email,
        city: client.city,
        country: client.country,
      }));
    },
  },
  {
    name: 'search_contracts',
    description: 'Search authorized contracts.',
    module: 'contracts',
    requiredPermission: 'contracts.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: searchInput,
    execute: async (input, context) => {
      const result = await contractService.list(context.user.id, contractScope(context, 'contracts.view'), {
        page: '1',
        limit: String(input.limit),
        search: input.query,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      } as any);
      return result.data.map(summarizeContract);
    },
  },
  {
    name: 'get_contract_details',
    description: 'Get authorized contract details.',
    module: 'contracts',
    requiredPermission: 'contracts.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: contractIdInput,
    execute: async (input, context) => summarizeContract(await getContract(context, input.contractId)),
  },
  {
    name: 'get_contract_consumption',
    description: 'Summarize approved and invoiced consumption for a contract.',
    module: 'contracts',
    requiredPermission: 'contracts.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: contractIdInput,
    execute: async (input, context) => {
      const contract: any = await getContract(context, input.contractId);
      const entries = contract.timeEntries ?? [];
      const approved = entries.filter((entry: any) => entry.status === ContractTimeEntryStatus.APPROVED);
      const invoiced = entries.filter((entry: any) => entry.status === ContractTimeEntryStatus.INVOICED || entry.invoiceId);
      const sum = (rows: any[]) => rows.reduce((total, row) => total + Number(row.calculatedAmount ?? 0), 0);
      return {
        contract: summarizeContract(contract),
        approvedCount: approved.length,
        approvedAmount: sum(approved),
        invoicedCount: invoiced.length,
        invoicedAmount: sum(invoiced),
        currency: contract.currency,
      };
    },
  },
  {
    name: 'list_timesheets',
    description: 'List timesheets linked to one authorized contract.',
    module: 'contracts',
    requiredPermission: 'contracts.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: listTimesheetsInput,
    execute: async (input, context) => {
      const contract: any = await getContract(context, input.contractId);
      return (contract.timeEntries ?? [])
        .filter((entry: any) => !input.status || entry.status === input.status)
        .filter((entry: any) => !input.workDate || toDateOnly(entry.workDate) === input.workDate)
        .map(summarizeTimeEntry);
    },
  },
  {
    name: 'get_timesheet_details',
    description: 'Get one authorized contract timesheet by ID.',
    module: 'contracts',
    requiredPermission: 'contracts.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: timeEntryDetailsInput,
    execute: async (input, context) => {
      const contract: any = await getContract(context, input.contractId);
      const entry = (contract.timeEntries ?? []).find((row: any) => row.id === input.timeEntryId);
      if (!entry) throw ApiError.notFound('Time entry');
      return {
        contract: summarizeContract(contract),
        timeEntry: summarizeTimeEntry(entry),
      };
    },
  },
  {
    name: 'list_ready_to_invoice',
    description: 'List approved billable timesheets that are ready for invoice generation.',
    module: 'contracts',
    requiredPermission: 'contracts.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: contractIdInput,
    execute: async (input, context) => {
      const contract: any = await getContract(context, input.contractId);
      return (contract.timeEntries ?? [])
        .filter((entry: any) => entry.status === ContractTimeEntryStatus.APPROVED && !entry.invoiceId && entry.billable)
        .map(summarizeTimeEntry);
    },
  },
  {
    name: 'get_invoice_details',
    description: 'Get an authorized invoice by ID.',
    module: 'invoices',
    requiredPermission: 'invoices.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: invoiceIdInput,
    execute: async (input, context) => {
      ensureToolPermission(context, 'invoices.view');
      const invoice: any = await invoiceService.getInvoiceById(input.invoiceId, context.user.id, permissionScope(context.user.permissionScopes, 'invoices.view'));
      return {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        customer: invoice.customer ? invoice.customer.company || invoice.customer.name : null,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        total: money(invoice.total),
        balanceDue: money(invoice.balanceDue),
        currency: invoice.currency,
        contractId: invoice.contractId,
      };
    },
  },
  {
    name: 'generate_invoice_pdf',
    description: 'Prepare secure invoice PDF download information for an authorized invoice.',
    module: 'invoices',
    requiredPermission: 'invoices.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: invoiceIdInput,
    execute: async (input, context) => {
      ensureToolPermission(context, 'invoices.view');
      const invoice: any = await invoiceService.getInvoiceById(input.invoiceId, context.user.id, permissionScope(context.user.permissionScopes, 'invoices.view'));
      return {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        customer: invoice.customer?.company || invoice.customer?.name,
        total: money(invoice.total),
        currency: invoice.currency,
        downloadEndpoint: `/api/invoices/${invoice.id}/pdf`,
      };
    },
  },
  {
    name: 'search_audit_logs',
    description: 'Search enterprise audit logs.',
    module: 'audit',
    requiredPermission: 'audit_logs.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: auditSearchInput,
    execute: async (input, context) => {
      ensureToolPermission(context, 'audit_logs.view');
      const result = await auditService.list({
        page: 1,
        limit: input.limit,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        search: input.search,
        module: input.module,
        entity: input.entity,
        action: input.action,
      });
      return result.data.map((row: any) => ({
        id: row.id,
        user: row.user?.email ?? 'system',
        module: row.module,
        entity: row.entity,
        entityId: row.entityId,
        action: row.action,
        success: row.success,
        createdAt: row.createdAt,
        route: row.route,
      }));
    },
  },
  {
    name: 'create_timesheet',
    description: 'Prepare creation of a billable contract timesheet. Requires explicit confirmation.',
    module: 'contracts',
    requiredPermission: 'contracts.time_entries.create',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: createTimesheetInput,
    form: {
      title: text('Créer un temps facturable', 'Create billable timesheet', 'إنشاء إدخال وقت قابل للفوترة'),
      description: text('Complétez les informations de temps avant de générer la prévisualisation.', 'Complete the timesheet information before generating the preview.', 'أكمل بيانات الوقت قبل إنشاء المعاينة.'),
      buildInitialValue: (partialInput) => ({
        breakMinutes: 0,
        billable: true,
        submit: false,
        ...partialInput,
      }),
      fields: [
        { path: 'contractId', type: 'entity', entityType: 'contract', label: text('Contrat', 'Contract', 'العقد'), required: true, resolveDisplayValue: resolveContractDisplayValue },
        { path: 'clientId', type: 'entity', entityType: 'customer', label: text('Client', 'Customer', 'العميل'), readOnly: true, resolveDisplayValue: resolveContractClientDisplayValue },
        { path: 'workDate', type: 'date', label: text('Date de travail', 'Work date', 'تاريخ العمل'), required: true },
        { path: 'startTime', type: 'datetime', label: text('Début', 'Start', 'البداية') },
        { path: 'endTime', type: 'datetime', label: text('Fin', 'End', 'النهاية') },
        { path: 'quantity', type: 'number', label: text('Quantité', 'Quantity', 'الكمية') },
        { path: 'breakMinutes', type: 'number', label: text('Pause (minutes)', 'Break (minutes)', 'الاستراحة (بالدقائق)') },
        { path: 'activityType', type: 'text', label: text('Activité', 'Activity', 'النشاط') },
        { path: 'description', type: 'textarea', label: text('Description', 'Description', 'الوصف'), required: true },
        { path: 'internalNote', type: 'textarea', label: text('Note interne', 'Internal note', 'ملاحظة داخلية') },
        { path: 'billable', type: 'boolean', label: text('Facturable', 'Billable', 'قابل للفوترة') },
        { path: 'submit', type: 'boolean', label: text('Soumettre après création', 'Submit after creation', 'إرسال بعد الإنشاء') },
      ],
    },
    preview: async (input, context) => previewContractAction(context, input.contractId, 'Create contract timesheet', input.description),
    execute: async (input, context) => contractService.createTimeEntry(input.contractId, context.user, contractScope(context, 'contracts.time_entries.create', AI_ASSISTANT_PERMISSIONS.useWriteTools), input),
  },
  {
    name: 'update_draft_timesheet',
    description: 'Prepare update of a draft or rejected contract timesheet. Requires explicit confirmation.',
    module: 'contracts',
    requiredPermission: 'contracts.time_entries.update',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: updateTimesheetInput,
    preview: async (input, context) => previewContractAction(context, input.contractId, 'Update contract timesheet', `Timesheet ${input.timeEntryId}`),
    execute: async (input, context) => {
      const { timeEntryId, contractId, ...data } = input;
      return contractService.updateTimeEntry(contractId, timeEntryId, context.user, contractScope(context, 'contracts.time_entries.update', AI_ASSISTANT_PERMISSIONS.useWriteTools), data);
    },
  },
  {
    name: 'submit_timesheet',
    description: 'Prepare submission of a draft or rejected timesheet. Requires explicit confirmation.',
    module: 'contracts',
    requiredPermission: 'contracts.time_entries.submit',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: timeEntryActionInput.omit({ reason: true }),
    preview: async (input, context) => previewContractAction(context, input.contractId, 'Submit timesheet', `Timesheet ${input.timeEntryId}`),
    execute: async (input, context) => contractService.submitTimeEntry(input.contractId, input.timeEntryId, context.user, contractScope(context, 'contracts.time_entries.submit', AI_ASSISTANT_PERMISSIONS.useWriteTools)),
  },
  {
    name: 'approve_timesheet',
    description: 'Prepare approval of a submitted timesheet. Requires explicit confirmation.',
    module: 'contracts',
    requiredPermission: 'contracts.time_entries.approve',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: timeEntryActionInput.omit({ reason: true }),
    preview: async (input, context) => previewContractAction(context, input.contractId, 'Approve timesheet', `Timesheet ${input.timeEntryId}`),
    execute: async (input, context) => contractService.approveTimeEntry(input.contractId, input.timeEntryId, context.user, contractScope(context, 'contracts.time_entries.approve', AI_ASSISTANT_PERMISSIONS.useWriteTools)),
  },
  {
    name: 'reject_timesheet',
    description: 'Prepare rejection of a submitted timesheet. Requires explicit confirmation.',
    module: 'contracts',
    requiredPermission: 'contracts.time_entries.reject',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: timeEntryActionInput.required({ reason: true }),
    preview: async (input, context) => previewContractAction(context, input.contractId, 'Reject timesheet', input.reason ?? ''),
    execute: async (input, context) => contractService.rejectTimeEntry(input.contractId, input.timeEntryId, context.user, contractScope(context, 'contracts.time_entries.reject', AI_ASSISTANT_PERMISSIONS.useWriteTools), { reason: input.reason! }),
  },
  {
    name: 'prepare_invoice_preview',
    description: 'Preview the contract invoice generation source before confirmation.',
    module: 'contracts',
    requiredPermission: 'contracts.billing.generate',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: generateInvoiceInput,
execute: async (input, context) => {
  const contract: any = await getContract(
    context,
    input.contractId,
    'contracts.billing.generate'
  );

  assertInvoiceReadyContract(contract);

  return buildInvoicePreview(contract, input);
},
  },
  {
    name: 'generate_invoice_from_timesheets',
    description: 'Prepare invoice generation from approved contract timesheets. Requires explicit confirmation.',
    module: 'contracts',
    requiredPermission: 'contracts.billing.generate',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: generateInvoiceInput,
    preview: async (input, context) => {
      const previewTool = aiTools.find((tool) => tool.name === 'prepare_invoice_preview')!;
      const summary = await previewTool.execute(input, context);
      return { title: 'Generate contract invoice', description: 'Create a draft invoice from approved billable contract work.', summary: summary as Record<string, unknown> };
    },
    execute: async (input, context) => contractService.generateBillingInvoice(input.contractId, context.user, contractScope(context, 'contracts.billing.generate', AI_ASSISTANT_PERMISSIONS.useWriteTools), {
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      milestoneId: input.milestoneId,
      scheduleItemId: input.scheduleItemId,
    }),
  },
  {
    name: 'send_invoice_email',
    description: 'Prepare sending an invoice PDF by email. Requires explicit confirmation.',
    module: 'invoices',
    requiredPermission: 'invoices.send',
    riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
    schema: invoiceEmailInput,
    preview: async (input, context) => {
      ensureToolPermission(context, 'invoices.send', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      const invoice: any = await invoiceService.getInvoiceById(input.invoiceId, context.user.id, permissionScope(context.user.permissionScopes, 'invoices.send'));
      return {
        title: 'Send invoice by email',
        description: `Invoice ${invoice.invoiceNumber}`,
        summary: {
          invoiceNumber: invoice.invoiceNumber,
          customer: invoice.customer?.company || invoice.customer?.name,
          to: input.recipientEmail ?? invoice.customer?.email,
          subject: input.subject ?? `Facture ${invoice.invoiceNumber}`,
          total: money(invoice.total),
          currency: invoice.currency,
        },
      };
    },
    execute: async (input, context) => {
      ensureToolPermission(context, 'invoices.send', AI_ASSISTANT_PERMISSIONS.useWriteTools);
      return invoiceService.sendInvoiceEmail(input.invoiceId, context.user.id, permissionScope(context.user.permissionScopes, 'invoices.send'), {
      recipientEmail: input.recipientEmail,
      subject: input.subject,
      message: input.message,
      });
    },
  },
];

export function toolInputHash(toolName: string, input: unknown, userId: string) {
  return crypto.createHash('sha256').update(JSON.stringify({ toolName, input, userId })).digest('hex');
}
