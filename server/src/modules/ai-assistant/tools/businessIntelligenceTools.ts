import {
  AiToolRiskLevel,
  ContractStatus,
  ContractTimeEntryStatus,
  CreditNoteStatus,
  DevisStatus,
  ExpenseNoteStatus,
  InvoiceStatus,
  PermissionScope,
  Prisma,
} from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@config/database';
import {
  contractAccessWhere,
  creditNoteAccessWhere,
  customerAccessWhere,
  devisAccessWhere,
  expenseNoteAccessWhere,
  invoiceAccessWhere,
  paymentAccessWhere,
  permissionScope,
} from '@modules/rbac/accessScope';
import { ApiError } from '@utils/ApiError';
import type { AiTool, AssistantUser, ToolContext } from './toolTypes';

const limitInput = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(15),
}).strict();

const approvalCenterInput = z.object({
  search: z.string().trim().max(160).optional(),
  module: z.string().trim().max(80).optional(),
  risk: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

const contractHealthInput = z.object({
  contractId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(25).default(10),
}).strict();

const customerHealthInput = z.object({
  customerId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(25).default(10),
}).strict();

type ApprovalItem = {
  id: string;
  module: string;
  action: string;
  entity: string;
  entityReference: string;
  requestedBy: string;
  requestedAt: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  status: 'PENDING';
  reason?: string | null;
  expiresAt?: string | null;
  permissionRequired: string;
  summary: Record<string, unknown>;
  openEntity?: Record<string, string>;
};

type BusinessInsight = {
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  module: string;
  entityName: string;
  customer?: string;
  status?: string;
  explanation: string;
  businessImpact: string;
  recommendedAction: string;
  actionType: 'VIEW_CONTRACT' | 'OPEN_CUSTOMER' | 'GENERATE_INVOICE_DRAFT' | 'REVIEW_TIMESHEETS' | 'SEND_REMINDER' | 'REVIEW_PAYMENTS' | 'REVIEW_APPROVALS';
  remainingBudget?: number | null;
  daysRemaining?: number | null;
  healthScore?: number;
  confidence?: number;
  detectedConditions?: string[];
  currency?: string;
};

type BusinessPriority = {
  rank: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  title: string;
  explanation: string;
  actionType: BusinessInsight['actionType'];
  count?: number;
  amount?: number;
  currency?: string;
};

const internalSignatureFixtureInvoicePattern = /^SIG-[0-9a-f-]+-(?:UNSIGNED|SIGNED|UNSIGN|SNAPSHOT|NO-ASSETS)$/i;

function isInternalSignatureFixtureInvoiceNumber(value: unknown) {
  return typeof value === 'string' && internalSignatureFixtureInvoicePattern.test(value.trim());
}

type RecentActivity = {
  id: string;
  module: string;
  entity: string;
  entityName: string;
  action: string;
  actor: string;
  success: boolean;
  createdAt: string;
};

function hasPermission(user: AssistantUser, permission: string) {
  return user.permissions.includes(permission) && Boolean(user.permissionScopes?.[permission]);
}

function scope(user: AssistantUser, permission: string): PermissionScope {
  return permissionScope(user.permissionScopes, permission);
}

function decimal(value: unknown): number {
  if (value == null) return 0;
  return Number(value);
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function daysUntil(value: Date | string | null | undefined): number | null {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.ceil((date.getTime() - today.getTime()) / 86400000);
}

function applySearch(items: ApprovalItem[], search?: string) {
  const query = search?.trim().toLowerCase();
  if (!query) return items;
  return items.filter((item) => JSON.stringify(item).toLowerCase().includes(query));
}

function riskFromScore(score: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (score >= 75) return 'LOW';
  if (score >= 45) return 'MEDIUM';
  return 'HIGH';
}

function sum<T>(rows: T[], selector: (row: T) => number): number {
  return Number(rows.reduce((total, row) => total + selector(row), 0).toFixed(2));
}

function severityWeight(severity: 'LOW' | 'MEDIUM' | 'HIGH') {
  if (severity === 'HIGH') return 3;
  if (severity === 'MEDIUM') return 2;
  return 1;
}

function confidenceFromEvidence(values: unknown[]) {
  const available = values.filter((value) => value !== null && value !== undefined && value !== '').length;
  if (available >= 5) return 96;
  if (available >= 3) return 82;
  if (available >= 2) return 68;
  return 54;
}

function requireAnyReadPermission(user: AssistantUser) {
  if (![
    'invoices.view',
    'contracts.view',
    'clients.view',
    'payments.view',
    'devis.view',
    'credit_notes.view',
    'expense_notes.view',
  ].some((permission) => hasPermission(user, permission))) {
    throw ApiError.forbidden('You are not authorized to view business intelligence.');
  }
}

async function listApprovalCenter(context: ToolContext, input: z.infer<typeof approvalCenterInput>) {
  const { user } = context;
  const items: ApprovalItem[] = [];
  const now = new Date();

  if (hasPermission(user, 'ai_assistant.confirm_actions')) {
    const actions = await prisma.aiPendingAction.findMany({
      where: { status: 'PENDING', expiresAt: { gt: now } },
      take: input.limit,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { name: true, email: true } } },
    });
    items.push(...actions.map((action) => ({
      id: action.id,
      module: 'AI Assistant',
      action: 'AI Pending Action',
      entity: 'Pending Action',
      entityReference: action.toolName.replace(/_/g, ' '),
      requestedBy: action.user?.name || action.user?.email || 'System',
      requestedAt: action.createdAt.toISOString(),
      riskLevel: action.riskLevel === 'REAUTH_REQUIRED' ? 'HIGH' as const : 'MEDIUM' as const,
      status: 'PENDING' as const,
      expiresAt: action.expiresAt.toISOString(),
      permissionRequired: action.requiredPermission,
      summary: { action: action.toolName, riskLevel: action.riskLevel },
    })));
  }

  if (hasPermission(user, 'contracts.time_entries.approve')) {
    const entries = await prisma.contractTimeEntry.findMany({
      where: {
        status: ContractTimeEntryStatus.SUBMITTED,
        contract: contractAccessWhere(user.id, scope(user, 'contracts.time_entries.approve')),
      },
      take: input.limit,
      orderBy: { submittedAt: 'asc' },
      include: {
        user: { select: { name: true, email: true } },
        submittedBy: { select: { name: true, email: true } },
        contract: { select: { id: true, contractNumber: true, title: true, client: { select: { name: true, company: true } } } },
      },
    });
    items.push(...entries.map((entry) => ({
      id: entry.id,
      module: 'Contracts',
      action: 'Timesheet Approval',
      entity: 'Timesheet',
      entityReference: `${entry.contract.contractNumber} - ${entry.activityType ?? entry.description.slice(0, 40)}`,
      requestedBy: entry.submittedBy?.name || entry.user.name || entry.user.email,
      requestedAt: (entry.submittedAt ?? entry.createdAt).toISOString(),
      riskLevel: decimal(entry.calculatedAmount) > 10000 ? 'HIGH' as const : 'LOW' as const,
      status: 'PENDING' as const,
      permissionRequired: 'contracts.time_entries.approve',
      summary: {
        contract: entry.contract.contractNumber,
        client: entry.contract.client.company || entry.contract.client.name,
        durationMinutes: entry.durationMinutes,
        amount: decimal(entry.calculatedAmount),
        currency: entry.currency,
      },
      openEntity: { entityType: 'contract', entityId: entry.contract.id, readableReference: entry.contract.contractNumber },
    })));
  }

  if (hasPermission(user, 'expense_notes.approve')) {
    const notes = await prisma.expenseNote.findMany({
      where: { ...expenseNoteAccessWhere(user.id, scope(user, 'expense_notes.approve')), status: ExpenseNoteStatus.SUBMITTED },
      take: input.limit,
      orderBy: { submittedAt: 'asc' },
      include: {
        createdBy: { select: { name: true, email: true } },
        category: { select: { name: true } },
        expenseType: { select: { name: true } },
      },
    });
    items.push(...notes.map((note) => ({
      id: note.id,
      module: 'Expense Notes',
      action: 'Expense Approval',
      entity: 'Expense Note',
      entityReference: note.merchantName || note.receiptNumber || note.category.name,
      requestedBy: note.createdBy.name || note.createdBy.email,
      requestedAt: (note.submittedAt ?? note.createdAt).toISOString(),
      riskLevel: decimal(note.amountTTC) > 5000 ? 'MEDIUM' as const : 'LOW' as const,
      status: 'PENDING' as const,
      permissionRequired: 'expense_notes.approve',
      summary: {
        category: note.category.name,
        type: note.expenseType.name,
        amount: decimal(note.amountTTC),
        currency: note.currency,
        merchant: note.merchantName,
      },
    })));
  }

  if (hasPermission(user, 'devis.approve')) {
    const quotes = await prisma.devis.findMany({
      where: { ...devisAccessWhere(user.id, scope(user, 'devis.approve')), status: DevisStatus.SENT },
      take: input.limit,
      orderBy: { sentAt: 'asc' },
      include: { customer: { select: { name: true, company: true } }, createdBy: { select: { name: true, email: true } } },
    });
    items.push(...quotes.map((quote) => ({
      id: quote.id,
      module: 'Quotes',
      action: 'Quote Approval',
      entity: 'Quote',
      entityReference: quote.devisNumber,
      requestedBy: quote.createdBy.name || quote.createdBy.email,
      requestedAt: (quote.sentAt ?? quote.createdAt).toISOString(),
      riskLevel: decimal(quote.total) > 50000 ? 'MEDIUM' as const : 'LOW' as const,
      status: 'PENDING' as const,
      permissionRequired: 'devis.approve',
      summary: {
        client: quote.customer.company || quote.customer.name,
        total: decimal(quote.total),
        currency: quote.currency,
        validUntil: iso(quote.validUntil),
      },
    })));
  }

  if (hasPermission(user, 'credit_notes.validate')) {
    const creditNotes = await prisma.creditNote.findMany({
      where: { ...creditNoteAccessWhere(user.id, scope(user, 'credit_notes.validate')), status: CreditNoteStatus.DRAFT },
      take: input.limit,
      orderBy: { createdAt: 'asc' },
      include: {
        customer: { select: { name: true, company: true } },
        createdBy: { select: { name: true, email: true } },
        invoice: { select: { invoiceNumber: true } },
      },
    });
    items.push(...creditNotes.map((creditNote) => ({
      id: creditNote.id,
      module: 'Credit Notes',
      action: 'Credit Note Validation',
      entity: 'Credit Note',
      entityReference: creditNote.creditNoteNumber,
      requestedBy: creditNote.createdBy.name || creditNote.createdBy.email,
      requestedAt: creditNote.createdAt.toISOString(),
      riskLevel: decimal(creditNote.total) > 10000 ? 'HIGH' as const : 'MEDIUM' as const,
      status: 'PENDING' as const,
      permissionRequired: 'credit_notes.validate',
      summary: {
        invoice: creditNote.invoice.invoiceNumber,
        client: creditNote.customer.company || creditNote.customer.name,
        total: decimal(creditNote.total),
        currency: creditNote.currency,
        reason: creditNote.reasonCodeSnapshot,
      },
    })));
  }

  return applySearch(items, input.search)
    .filter((item) => !input.module || item.module.toLowerCase().includes(input.module!.toLowerCase()))
    .filter((item) => !input.risk || item.riskLevel === input.risk)
    .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt))
    .slice(0, input.limit);
}

async function contractHealth(context: ToolContext, input: z.infer<typeof contractHealthInput>) {
  const { user } = context;
  const permission = 'contracts.view';
  if (!hasPermission(user, permission)) throw ApiError.forbidden('You are not authorized to view contract health.');
  const where: Prisma.ContractWhereInput = {
    ...contractAccessWhere(user.id, scope(user, permission)),
    ...(input.contractId ? { id: input.contractId } : {}),
  };
  const contracts = await prisma.contract.findMany({
    where,
    take: input.limit,
    orderBy: [{ endDate: 'asc' }, { updatedAt: 'desc' }],
    include: {
      client: { select: { name: true, company: true } },
      invoices: { select: { total: true, balanceDue: true, status: true, paidAt: true, dueDate: true } },
      timeEntries: { select: { status: true, billableMinutes: true, calculatedAmount: true, invoiceId: true } },
    },
  });
  return contracts.map((contract) => {
    const budget = decimal(contract.amount ?? contract.fixedAmount);
    const invoiced = sum(contract.invoices, (invoice) => decimal(invoice.total));
    const approvedReady = contract.timeEntries.filter((entry) => entry.status === ContractTimeEntryStatus.APPROVED && !entry.invoiceId);
    const approvedReadyAmount = sum(approvedReady, (entry) => decimal(entry.calculatedAmount));
    const consumptionPercent = budget > 0 ? Math.min(100, Math.round((invoiced / budget) * 100)) : 0;
    const remainingBudget = budget > 0 ? Math.max(0, Number((budget - invoiced).toFixed(2))) : null;
    const daysRemaining = daysUntil(contract.endDate);
    const warnings = [
      consumptionPercent >= 90 ? 'Budget consumption is above 90%.' : null,
      daysRemaining !== null && daysRemaining <= 14 && daysRemaining >= 0 ? 'Contract expires soon.' : null,
      approvedReady.length > 0 ? 'Approved billable time is ready to invoice.' : null,
      contract.status === ContractStatus.EXPIRED ? 'Contract is expired.' : null,
    ].filter(Boolean);
    const score = Math.max(0, 100 - (consumptionPercent >= 90 ? 30 : 0) - (daysRemaining !== null && daysRemaining <= 14 ? 25 : 0) - (approvedReady.length ? 10 : 0));
    return {
      contractNumber: contract.contractNumber,
      title: contract.title,
      client: contract.client.company || contract.client.name,
      status: contract.status,
      healthScore: score,
      riskLevel: riskFromScore(score),
      budget,
      invoiced,
      remainingBudget,
      budgetConsumptionPercent: consumptionPercent,
      daysRemaining,
      readyToInvoiceAmount: approvedReadyAmount,
      readyToInvoiceCount: approvedReady.length,
      currency: contract.currency,
      warnings,
      recommendations: [
        approvedReady.length ? 'Generate an invoice for approved billable time.' : null,
        daysRemaining !== null && daysRemaining <= 14 && daysRemaining >= 0 ? 'Schedule a renewal discussion.' : null,
        consumptionPercent >= 90 ? 'Review budget extension or renewal terms.' : null,
      ].filter(Boolean),
    };
  }).sort((left, right) => left.healthScore - right.healthScore);
}

async function customerHealth(context: ToolContext, input: z.infer<typeof customerHealthInput>) {
  const { user } = context;
  const permission = 'clients.view';
  if (!hasPermission(user, permission)) throw ApiError.forbidden('You are not authorized to view customer health.');
  const customers = await prisma.customer.findMany({
    where: { ...customerAccessWhere(user.id, scope(user, permission)), ...(input.customerId ? { id: input.customerId } : {}) },
    take: input.limit,
    orderBy: { updatedAt: 'desc' },
    include: {
      contracts: { select: { status: true } },
      invoices: { select: { total: true, balanceDue: true, dueDate: true, paidAt: true, status: true } },
      creditNotes: { select: { total: true, status: true } },
    },
  });
  const now = new Date();
  return customers.map((customer) => {
    const invoices = customer.invoices;
    const overdue = invoices.filter((invoice) => decimal(invoice.balanceDue) > 0 && invoice.dueDate < now);
    const revenue = sum(invoices, (invoice) => decimal(invoice.total));
    const openBalance = sum(invoices, (invoice) => decimal(invoice.balanceDue));
    const creditTotal = sum(customer.creditNotes, (creditNote) => decimal(creditNote.total));
    const activeContracts = customer.contracts.filter((contract) => contract.status === ContractStatus.ACTIVE || contract.status === ContractStatus.SIGNED).length;
    const score = Math.max(0, 100 - overdue.length * 12 - (openBalance > 0 ? 10 : 0) - (creditTotal > revenue * 0.2 && revenue > 0 ? 20 : 0));
    return {
      customer: customer.company || customer.name,
      email: customer.email,
      active: customer.isActive,
      revenue,
      openBalance,
      overdueInvoices: overdue.length,
      activeContracts,
      creditNotesTotal: creditTotal,
      riskScore: 100 - score,
      riskLevel: riskFromScore(score),
      recommendations: [
        overdue.length ? 'Follow up on overdue invoices.' : null,
        !customer.isActive ? 'Review inactive customer status.' : null,
        activeContracts === 0 ? 'Check whether a new contract opportunity exists.' : null,
      ].filter(Boolean),
    };
  }).sort((left, right) => right.riskScore - left.riskScore);
}

async function revenueIntelligence(context: ToolContext) {
  const { user } = context;
  const permission = 'invoices.view';
  if (!hasPermission(user, permission)) throw ApiError.forbidden('You are not authorized to view revenue intelligence.');
  const invoiceWhere = invoiceAccessWhere(user.id, scope(user, permission));
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const [monthInvoices, overdueInvoicesRaw, readyEntries] = await Promise.all([
    prisma.invoice.findMany({ where: { ...invoiceWhere, issueDate: { gte: monthStart, lt: nextMonth } }, select: { total: true, amountPaid: true, balanceDue: true, status: true, currency: true } }),
    prisma.invoice.findMany({ where: { ...invoiceWhere, balanceDue: { gt: 0 }, dueDate: { lt: now }, status: { not: InvoiceStatus.CANCELLED } }, select: { invoiceNumber: true, balanceDue: true, dueDate: true, customer: { select: { name: true, company: true } }, currency: true } }),
    hasPermission(user, 'contracts.view')
      ? prisma.contractTimeEntry.findMany({
        where: { status: ContractTimeEntryStatus.APPROVED, invoiceId: null, billable: true, contract: contractAccessWhere(user.id, scope(user, 'contracts.view')) },
        select: { calculatedAmount: true, currency: true, contract: { select: { contractNumber: true, client: { select: { name: true, company: true } } } } },
      })
      : Promise.resolve([]),
  ]);
  const overdueInvoices = overdueInvoicesRaw.filter((invoice) => !isInternalSignatureFixtureInvoiceNumber(invoice.invoiceNumber));
  return {
    revenueThisMonth: sum(monthInvoices, (invoice) => decimal(invoice.total)),
    collectedThisMonth: sum(monthInvoices, (invoice) => decimal(invoice.amountPaid)),
    outstandingBalance: sum(monthInvoices, (invoice) => decimal(invoice.balanceDue)),
    overdueAmount: sum(overdueInvoices, (invoice) => decimal(invoice.balanceDue)),
    overdueCount: overdueInvoices.length,
    readyToInvoiceRevenue: sum(readyEntries, (entry) => decimal(entry.calculatedAmount)),
    readyToInvoiceCount: readyEntries.length,
    currency: monthInvoices[0]?.currency ?? readyEntries[0]?.currency ?? 'MAD',
    topOverdue: overdueInvoices.slice(0, 5).map((invoice) => ({
      invoiceNumber: invoice.invoiceNumber,
      client: invoice.customer.company || invoice.customer.name,
      balanceDue: decimal(invoice.balanceDue),
      dueDate: iso(invoice.dueDate),
      currency: invoice.currency,
    })),
    recommendations: [
      readyEntries.length ? `Generate invoices for ${readyEntries.length} approved billable timesheet entries.` : null,
      overdueInvoices.length ? `Follow up on ${overdueInvoices.length} overdue invoice(s).` : null,
    ].filter(Boolean),
  };
}

async function executiveBriefing(context: ToolContext, input: z.infer<typeof limitInput>) {
  requireAnyReadPermission(context.user);
  const [approvals, revenue, contracts, customers, recentActivity] = await Promise.all([
    listApprovalCenter(context, { limit: input.limit }),
    hasPermission(context.user, 'invoices.view') ? revenueIntelligence(context) : Promise.resolve(null),
    hasPermission(context.user, 'contracts.view') ? contractHealth(context, { limit: input.limit }) : Promise.resolve([]),
    hasPermission(context.user, 'clients.view') ? customerHealth(context, { limit: input.limit }) : Promise.resolve([]),
    hasPermission(context.user, 'audit_logs.view')
      ? prisma.auditLog.findMany({
        take: Math.min(input.limit, 8),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          module: true,
          entity: true,
          entityId: true,
          action: true,
          success: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
          newValues: true,
          metadata: true,
        },
      }).then((logs): RecentActivity[] => logs.map((log) => {
        const values = log.newValues && typeof log.newValues === 'object' && !Array.isArray(log.newValues)
          ? log.newValues as Record<string, unknown>
          : {};
        const metadata = log.metadata && typeof log.metadata === 'object' && !Array.isArray(log.metadata)
          ? log.metadata as Record<string, unknown>
          : {};
        return {
          id: log.id,
          module: log.module,
          entity: log.entity,
          entityName: String(values.invoiceNumber ?? values.contractNumber ?? values.creditNoteNumber ?? values.devisNumber ?? metadata.number ?? metadata.displayName ?? log.entityId ?? log.entity),
          action: log.action,
          actor: log.user?.name || log.user?.email || 'System',
          success: log.success,
          createdAt: log.createdAt.toISOString(),
        };
      }))
      : Promise.resolve([]),
  ]);
  const contractInsights: BusinessInsight[] = contracts.flatMap((contract) => {
    const insights: BusinessInsight[] = [];
    if (contract.readyToInvoiceCount > 0) {
      insights.push({
        severity: contract.readyToInvoiceAmount > 50000 ? 'HIGH' : 'MEDIUM',
        module: 'Contracts',
        entityName: contract.contractNumber,
        customer: contract.client,
        status: String(contract.status),
        explanation: `${contract.readyToInvoiceCount} approved billable timesheet(s) are ready to invoice.`,
        businessImpact: `Generating invoices could increase recognized revenue by ${contract.readyToInvoiceAmount} ${contract.currency}.`,
        recommendedAction: 'Generate an invoice draft for approved billable time.',
        actionType: 'GENERATE_INVOICE_DRAFT',
        remainingBudget: contract.remainingBudget,
        daysRemaining: contract.daysRemaining,
        healthScore: contract.healthScore,
        confidence: confidenceFromEvidence([contract.contractNumber, contract.client, contract.readyToInvoiceCount, contract.readyToInvoiceAmount, contract.currency, contract.status]),
        detectedConditions: ['approved_billable_time', 'not_invoiced'],
        currency: contract.currency,
      });
    }
    if (contract.daysRemaining !== null && contract.daysRemaining <= 14 && contract.daysRemaining >= 0) {
      insights.push({
        severity: contract.daysRemaining <= 7 ? 'HIGH' : 'MEDIUM',
        module: 'Contracts',
        entityName: contract.contractNumber,
        customer: contract.client,
        status: String(contract.status),
        explanation: `Contract expires in ${contract.daysRemaining} day(s).`,
        businessImpact: 'Renewing before expiration reduces service interruption and revenue leakage risk.',
        recommendedAction: 'Review renewal terms and contact the customer.',
        actionType: 'VIEW_CONTRACT',
        remainingBudget: contract.remainingBudget,
        daysRemaining: contract.daysRemaining,
        healthScore: contract.healthScore,
        confidence: confidenceFromEvidence([contract.contractNumber, contract.client, contract.daysRemaining, contract.status, contract.healthScore]),
        detectedConditions: ['contract_expiring_soon'],
        currency: contract.currency,
      });
    }
    if (contract.budgetConsumptionPercent >= 90) {
      insights.push({
        severity: 'HIGH',
        module: 'Contracts',
        entityName: contract.contractNumber,
        customer: contract.client,
        status: String(contract.status),
        explanation: `Budget consumption reached ${contract.budgetConsumptionPercent}%.`,
        businessImpact: 'The contract may exceed its commercial envelope if work continues without review.',
        recommendedAction: 'Review budget extension or renewal terms.',
        actionType: 'VIEW_CONTRACT',
        remainingBudget: contract.remainingBudget,
        daysRemaining: contract.daysRemaining,
        healthScore: contract.healthScore,
        confidence: confidenceFromEvidence([contract.contractNumber, contract.client, contract.budgetConsumptionPercent, contract.remainingBudget, contract.status]),
        detectedConditions: ['budget_consumption_above_threshold'],
        currency: contract.currency,
      });
    }
    return insights;
  });
  const customerInsights: BusinessInsight[] = customers.flatMap((customer) => {
    const insights: BusinessInsight[] = [];
    if (customer.overdueInvoices > 0) {
      insights.push({
        severity: customer.openBalance > 50000 ? 'HIGH' : 'MEDIUM',
        module: 'Customers',
        entityName: customer.customer,
        customer: customer.customer,
        status: customer.active ? 'ACTIVE' : 'INACTIVE',
        explanation: `${customer.overdueInvoices} overdue invoice(s) are linked to this customer.`,
        businessImpact: `Open balance exposure is ${customer.openBalance}. Collection follow-up protects cash flow.`,
        recommendedAction: 'Review overdue invoices and send a reminder.',
        actionType: 'SEND_REMINDER',
        healthScore: Math.max(0, 100 - customer.riskScore),
        confidence: confidenceFromEvidence([customer.customer, customer.overdueInvoices, customer.openBalance, customer.riskScore, customer.active]),
        detectedConditions: ['overdue_invoices', 'open_balance'],
      });
    }
    if (customer.activeContracts === 0) {
      insights.push({
        severity: 'LOW',
        module: 'Customers',
        entityName: customer.customer,
        customer: customer.customer,
        status: customer.active ? 'ACTIVE' : 'INACTIVE',
        explanation: 'No active contract is currently attached to this customer.',
        businessImpact: 'A dormant customer can reduce recurring revenue visibility.',
        recommendedAction: 'Review customer activity and identify a renewal or new contract opportunity.',
        actionType: 'OPEN_CUSTOMER',
        healthScore: Math.max(0, 100 - customer.riskScore),
        confidence: confidenceFromEvidence([customer.customer, customer.activeContracts, customer.active, customer.riskScore]),
        detectedConditions: ['no_active_contract'],
      });
    }
    return insights;
  });
  const revenueInsightCandidates: Array<BusinessInsight | null> = revenue ? [
    revenue.overdueCount > 0 ? {
      severity: revenue.overdueAmount > 50000 ? 'HIGH' as const : 'MEDIUM' as const,
      module: 'Invoices',
      entityName: 'Overdue invoices',
      status: 'OVERDUE',
      explanation: `${revenue.overdueCount} overdue invoice(s) are awaiting collection.`,
      businessImpact: `Cash exposure is ${revenue.overdueAmount} ${revenue.currency}.`,
      recommendedAction: 'Review overdue invoices and prioritize reminders.',
      actionType: 'SEND_REMINDER' as const,
      currency: revenue.currency,
      confidence: confidenceFromEvidence([revenue.overdueCount, revenue.overdueAmount, revenue.currency, revenue.topOverdue?.length]),
      detectedConditions: ['overdue_invoices', 'cash_collection_exposure'],
    } satisfies BusinessInsight : null,
    revenue.readyToInvoiceCount > 0 ? {
      severity: revenue.readyToInvoiceRevenue > 50000 ? 'HIGH' as const : 'MEDIUM' as const,
      module: 'Contracts',
      entityName: 'Approved billable time',
      status: 'APPROVED',
      explanation: `${revenue.readyToInvoiceCount} approved billable timesheet entry/entries are not invoiced yet.`,
      businessImpact: `Drafting invoices could add ${revenue.readyToInvoiceRevenue} ${revenue.currency} to this month's billing pipeline.`,
      recommendedAction: 'Generate invoice drafts from approved timesheets.',
      actionType: 'GENERATE_INVOICE_DRAFT' as const,
      currency: revenue.currency,
      confidence: confidenceFromEvidence([revenue.readyToInvoiceCount, revenue.readyToInvoiceRevenue, revenue.currency]),
      detectedConditions: ['approved_timesheets', 'not_invoiced'],
    } satisfies BusinessInsight : null,
  ] : [];
  const revenueInsights: BusinessInsight[] = revenueInsightCandidates.filter((item): item is BusinessInsight => Boolean(item));
  const insights = [...revenueInsights, ...contractInsights, ...customerInsights]
    .sort((left, right) => severityWeight(right.severity) - severityWeight(left.severity))
    .slice(0, input.limit);
  const expiringThisWeekCount = contracts.filter((contract) => contract.daysRemaining !== null && contract.daysRemaining <= 7 && contract.daysRemaining >= 0).length;
  const overBudgetCount = contracts.filter((contract) => contract.budgetConsumptionPercent >= 90).length;
  const priorityCandidates: Array<BusinessPriority | null> = [
    revenue?.overdueCount ? {
      rank: 0,
      severity: revenue.overdueAmount > 50000 ? 'HIGH' as const : 'MEDIUM' as const,
      title: `${revenue.overdueCount} overdue invoice(s)`,
      explanation: `Follow-up can reduce ${revenue.overdueAmount} ${revenue.currency} of collection exposure.`,
      actionType: 'SEND_REMINDER',
      count: revenue.overdueCount,
      amount: revenue.overdueAmount,
      currency: revenue.currency,
    } satisfies BusinessPriority : null,
    expiringThisWeekCount ? {
      rank: 0,
      severity: 'HIGH',
      title: `${expiringThisWeekCount} contract(s) expiring this week`,
      explanation: 'Renewal review reduces interruption and churn risk.',
      actionType: 'VIEW_CONTRACT',
      count: expiringThisWeekCount,
    } satisfies BusinessPriority : null,
    overBudgetCount ? {
      rank: 0,
      severity: 'HIGH',
      title: `${overBudgetCount} contract(s) over budget threshold`,
      explanation: 'Budget review is recommended before more work is consumed.',
      actionType: 'VIEW_CONTRACT',
      count: overBudgetCount,
    } satisfies BusinessPriority : null,
    revenue?.readyToInvoiceCount ? {
      rank: 0,
      severity: revenue.readyToInvoiceRevenue > 50000 ? 'HIGH' as const : 'MEDIUM' as const,
      title: `${revenue.readyToInvoiceCount} approved timesheet entry/entries ready to invoice`,
      explanation: `Potential invoice value is ${revenue.readyToInvoiceRevenue} ${revenue.currency}.`,
      actionType: 'GENERATE_INVOICE_DRAFT',
      count: revenue.readyToInvoiceCount,
      amount: revenue.readyToInvoiceRevenue,
      currency: revenue.currency,
    } satisfies BusinessPriority : null,
    approvals.length ? {
      rank: 0,
      severity: approvals.some((approval) => approval.riskLevel === 'HIGH') ? 'HIGH' as const : 'MEDIUM' as const,
      title: `${approvals.length} pending approval(s)`,
      explanation: 'Approvals can unblock billing, payments or controlled ERP actions.',
      actionType: 'REVIEW_APPROVALS',
      count: approvals.length,
    } satisfies BusinessPriority : null,
  ];
  const priorities: BusinessPriority[] = priorityCandidates.filter((item): item is BusinessPriority => Boolean(item))
    .sort((left, right) => severityWeight(right.severity) - severityWeight(left.severity))
    .map((item, index) => ({ ...item, rank: index + 1 }))
    .slice(0, 5);
  const alerts = insights.map((insight) => ({
    module: insight.module,
    reference: insight.entityName,
    entityName: insight.entityName,
    customer: insight.customer,
    status: insight.status,
    warning: insight.explanation,
    riskLevel: insight.severity,
    remainingBudget: insight.remainingBudget,
    daysRemaining: insight.daysRemaining,
    healthScore: insight.healthScore,
    actionType: insight.actionType,
    confidence: insight.confidence,
    detectedConditions: insight.detectedConditions,
  })).slice(0, input.limit);
  return {
    generatedAt: new Date().toISOString(),
    pendingApprovals: approvals.length,
    revenue,
    highestRiskContract: contracts[0] ?? null,
    highestRiskCustomer: customers[0] ?? null,
    priorities,
    insights,
    alerts,
    recommendations: [
      ...insights.map((insight) => ({
        title: insight.entityName,
        explanation: insight.explanation,
        businessImpact: insight.businessImpact,
        suggestedAction: insight.recommendedAction,
        actionType: insight.actionType,
        severity: insight.severity,
        confidence: insight.confidence,
        detectedConditions: insight.detectedConditions,
      })),
      ...(revenue?.recommendations ?? []),
    ].slice(0, input.limit),
    recentActivity,
    executiveSummary: {
      revenueThisMonth: revenue?.revenueThisMonth ?? null,
      outstandingBalance: revenue?.outstandingBalance ?? null,
      overdueAmount: revenue?.overdueAmount ?? null,
      readyToInvoiceRevenue: revenue?.readyToInvoiceRevenue ?? null,
      currency: revenue?.currency ?? 'MAD',
      contractRiskCount: contracts.filter((contract) => contract.riskLevel !== 'LOW').length,
      customerRiskCount: customers.filter((customer) => customer.riskLevel !== 'LOW').length,
      pendingApprovalCount: approvals.length,
    },
  };
}

export const businessIntelligenceTools: AiTool[] = [
  {
    name: 'list_approval_center',
    description: 'List pending enterprise approvals from existing ERP modules.',
    module: 'ai_approval_center',
    requiredPermission: 'ai_assistant.use_read_tools',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: approvalCenterInput,
    execute: async (input, context) => listApprovalCenter(context, input),
  },
  {
    name: 'get_executive_briefing',
    description: 'Generate an executive ERP briefing with approvals, alerts, revenue and recommendations.',
    module: 'ai_business_intelligence',
    requiredPermission: 'ai_assistant.use_read_tools',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: limitInput,
    execute: async (input, context) => executiveBriefing(context, input),
  },
  {
    name: 'analyze_contract_health',
    description: 'Analyze contract health, consumption, ready-to-invoice time and risks.',
    module: 'contracts',
    requiredPermission: 'contracts.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: contractHealthInput,
    execute: async (input, context) => contractHealth(context, input),
  },
  {
    name: 'analyze_customer_health',
    description: 'Analyze customer risk, revenue, overdue invoices and open balance.',
    module: 'customers',
    requiredPermission: 'clients.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: customerHealthInput,
    execute: async (input, context) => customerHealth(context, input),
  },
  {
    name: 'analyze_revenue_intelligence',
    description: 'Analyze revenue, overdue invoices and ready-to-invoice revenue.',
    module: 'invoices',
    requiredPermission: 'invoices.view',
    riskLevel: AiToolRiskLevel.READ_ONLY,
    schema: z.object({}).strict(),
    execute: async (_input, context) => revenueIntelligence(context),
  },
];
