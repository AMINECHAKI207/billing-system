import { prisma } from '@config/database';
import { logger } from '@config/logger';
import { invoiceService } from '@modules/invoice/invoice.service';
import { customerAccessWhere } from '@modules/rbac/accessScope';
import { ApiError } from '@utils/ApiError';
import { PermissionScope, Prisma, RecurringFrequency, RecurringPlanStatus, Role } from '@prisma/client';
import { parsePagination } from '@utils/pagination';
import { CreateRecurringPlanInput, RecurringPlanQueryInput, UpdateRecurringPlanInput } from './recurring.schema';

const includePlan = {
  customer: { select: { id: true, name: true, company: true, email: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  items: { orderBy: { sortOrder: 'asc' as const } },
  executions: { orderBy: { createdAt: 'desc' as const }, take: 10 },
  _count: { select: { invoices: true, executions: true } },
};

function normalizeDate(value: Date | string) { const d = new Date(value); d.setHours(0,0,0,0); return d; }
function addFrequency(date: Date, frequency: RecurringFrequency, count: number) {
  const next = new Date(date);
  if (frequency === 'WEEKLY') next.setDate(next.getDate() + 7 * count);
  if (frequency === 'MONTHLY') next.setMonth(next.getMonth() + count);
  if (frequency === 'QUARTERLY') next.setMonth(next.getMonth() + 3 * count);
  if (frequency === 'YEARLY') next.setFullYear(next.getFullYear() + count);
  return normalizeDate(next);
}

export class RecurringService {
  async list(userId: string, scope: PermissionScope, query: RecurringPlanQueryInput) {
    const { skip, limit, page } = parsePagination({ page: query.page, limit: query.limit });
    const where: Prisma.RecurringPlanWhereInput = {
      customer: customerAccessWhere(userId, scope),
      ...(query.status && { status: query.status }),
      ...(query.customerId && { customerId: query.customerId }),
      ...(query.search && { OR: [
        { name: { contains: query.search, mode: 'insensitive' } },
        { customer: { name: { contains: query.search, mode: 'insensitive' } } },
        { customer: { company: { contains: query.search, mode: 'insensitive' } } },
      ] }),
    };
    const [data, total] = await Promise.all([
      prisma.recurringPlan.findMany({ where, include: includePlan, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      prisma.recurringPlan.count({ where }),
    ]);
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async getById(id: string, userId: string, scope: PermissionScope) {
    const plan = await prisma.recurringPlan.findFirst({ where: { id, customer: customerAccessWhere(userId, scope) }, include: includePlan });
    if (!plan) throw ApiError.notFound('Recurring plan');
    return plan;
  }

  async create(user: { id: string; role: Role }, scope: PermissionScope, data: CreateRecurringPlanInput) {
    const customer = await prisma.customer.findFirst({ where: { id: data.customerId, ...customerAccessWhere(user.id, scope) } });
    if (!customer) throw ApiError.notFound('Customer');
    const startDate = normalizeDate(data.startDate);
    const endDate = data.endDate ? normalizeDate(data.endDate) : null;
    if (endDate && endDate < startDate) throw ApiError.badRequest('End date must be after start date');
    return prisma.recurringPlan.create({ data: {
      customerId: data.customerId, createdById: user.id, name: data.name,
      frequency: data.frequency, intervalCount: data.intervalCount, status: 'ACTIVE',
      startDate, nextRunDate: startDate, endDate, dueDays: data.dueDays,
      autoSend: data.autoSend, currency: data.currency, discount: data.discount,
      notes: data.notes, terms: data.terms,
      items: { create: data.items.map((item, index) => ({ ...item, sortOrder: index + 1 })) },
    }, include: includePlan });
  }

  async update(id: string, user: { id: string; role: Role }, scope: PermissionScope, data: UpdateRecurringPlanInput) {
    const existing = await this.getById(id, user.id, scope);
    if (existing.status === 'CANCELLED' || existing.status === 'COMPLETED') throw ApiError.badRequest('Closed recurring plans cannot be edited');
    if (data.customerId) {
      const customer = await prisma.customer.findFirst({ where: { id: data.customerId, ...customerAccessWhere(user.id, scope) } });
      if (!customer) throw ApiError.notFound('Customer');
    }
    const startDate = data.startDate ? normalizeDate(data.startDate) : existing.startDate;
    const endDate = data.endDate === null ? null : data.endDate ? normalizeDate(data.endDate) : existing.endDate;
    if (endDate && endDate < startDate) throw ApiError.badRequest('End date must be after start date');
    return prisma.$transaction(async (tx) => {
      if (data.items) { await tx.recurringPlanItem.deleteMany({ where: { planId: id } }); }
      return tx.recurringPlan.update({ where: { id }, data: {
        customerId: data.customerId, name: data.name, frequency: data.frequency,
        intervalCount: data.intervalCount, startDate: data.startDate ? startDate : undefined,
        nextRunDate: data.startDate ? startDate : undefined, endDate: data.endDate !== undefined ? endDate : undefined,
        dueDays: data.dueDays, autoSend: data.autoSend, currency: data.currency,
        discount: data.discount, notes: data.notes, terms: data.terms,
        ...(data.items && { items: { create: data.items.map((item, index) => ({ ...item, sortOrder: index + 1 })) } }),
      }, include: includePlan });
    });
  }

  async changeStatus(id: string, userId: string, scope: PermissionScope, status: 'ACTIVE'|'PAUSED'|'CANCELLED') {
    const plan = await this.getById(id, userId, scope);
    if (plan.status === 'COMPLETED') throw ApiError.badRequest('Completed plan cannot be reopened');
    if (plan.status === 'CANCELLED' && status !== 'CANCELLED') throw ApiError.badRequest('Cancelled plan cannot be reopened');
    return prisma.recurringPlan.update({ where: { id }, data: { status }, include: includePlan });
  }

  async runNow(id: string, user: { id: string; role: Role }, scope: PermissionScope) {
    const plan = await this.getById(id, user.id, scope);
    return this.executePlan(plan.id, normalizeDate(new Date()), true);
  }

  async executeDuePlans(now = new Date()) {
    const today = normalizeDate(now);
    const plans = await prisma.recurringPlan.findMany({ where: { status: 'ACTIVE', nextRunDate: { lte: today } }, select: { id: true } });
    const results = [];
    for (const plan of plans) {
      try { results.push(await this.executePlan(plan.id, today, false)); }
      catch (error) { logger.error('Recurring plan execution failed', { planId: plan.id, error }); }
    }
    return results;
  }

  private async executePlan(planId: string, scheduledFor: Date, manual: boolean) {
    const plan = await prisma.recurringPlan.findUnique({ where: { id: planId }, include: { customer: true, items: { orderBy: { sortOrder: 'asc' } } } });
    if (!plan) throw ApiError.notFound('Recurring plan');
    if (!manual && plan.status !== 'ACTIVE') throw ApiError.badRequest('Recurring plan is not active');
    const runDate = manual ? normalizeDate(new Date()) : normalizeDate(plan.nextRunDate);
    let execution;
    try {
      execution = await prisma.recurringExecution.create({
        data: { planId, scheduledFor: runDate, status: 'PROCESSING' },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return prisma.recurringExecution.findUniqueOrThrow({
          where: { planId_scheduledFor: { planId, scheduledFor: runDate } },
        });
      }
      throw error;
    }

    if (plan.endDate && runDate > normalizeDate(plan.endDate)) {
      await prisma.$transaction([
        prisma.recurringPlan.update({ where: { id: planId }, data: { status: 'COMPLETED' } }),
        prisma.recurringExecution.update({
          where: { id: execution.id },
          data: { status: 'SKIPPED', errorMessage: 'Plan end date reached' },
        }),
      ]);
      return prisma.recurringExecution.findUniqueOrThrow({ where: { id: execution.id } });
    }
    try {
      const dueDate = new Date(runDate); dueDate.setDate(dueDate.getDate() + plan.dueDays);
      const invoice = await invoiceService.createInvoice({ id: plan.createdById, role: Role.ADMIN }, PermissionScope.ALL, {
        customerId: plan.customerId, status: plan.autoSend ? 'SENT' : 'DRAFT',
        issueDate: runDate.toISOString(), dueDate: dueDate.toISOString(),
        discount: Number(plan.discount), notes: plan.notes, terms: plan.terms, currency: plan.currency,
        items: plan.items.map((item) => ({ description: item.description, unit: item.unit, quantity: Number(item.quantity), unitPrice: Number(item.unitPrice), taxRate: Number(item.taxRate) })),
      });
      const nextRun = addFrequency(runDate, plan.frequency, plan.intervalCount);
      const completed = Boolean(plan.endDate && nextRun > normalizeDate(plan.endDate));
      await prisma.$transaction([
        prisma.invoice.update({ where: { id: invoice.id }, data: { recurringPlanId: planId } }),
        prisma.recurringPlan.update({
          where: { id: planId },
          data: {
            lastRunAt: new Date(),
            nextRunDate: nextRun,
            status: completed ? 'COMPLETED' : plan.status,
          },
        }),
        prisma.recurringExecution.update({
          where: { id: execution.id },
          data: { invoiceId: invoice.id, status: 'SUCCESS', errorMessage: null },
        }),
      ]);
      return prisma.recurringExecution.findUniqueOrThrow({ where: { id: execution.id } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown recurring execution error';
      await prisma.recurringExecution.update({
        where: { id: execution.id },
        data: { status: 'FAILED', errorMessage: message },
      }).catch(() => undefined);
      throw error;
    }
  }
}
export const recurringService = new RecurringService();
