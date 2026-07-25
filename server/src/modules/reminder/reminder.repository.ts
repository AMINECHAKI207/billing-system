import { prisma } from '@config/database';
import { InvoiceStatus, Prisma, ReminderType } from '@prisma/client';

export class ReminderRepository {
  async findInvoiceForReminder(id: string) {
    return prisma.invoice.findUnique({
      where: { id },
      include: {
        customer: {
          select: { id: true, name: true, email: true, company: true },
        },
      },
    });
  }

  async create(data: Prisma.ReminderUncheckedCreateInput) {
    return prisma.reminder.create({
      data,
      include: this.defaultInclude(),
    });
  }

  async findInvoicesForAutomaticReminders(now = new Date()) {
    const dueSoon = new Date(now);
    dueSoon.setDate(dueSoon.getDate() + 7);

    return prisma.invoice.findMany({
      where: {
        balanceDue: { gt: 0 },
        status: { in: [InvoiceStatus.SENT, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE] },
        OR: [
          { dueDate: { lt: now } },
          { dueDate: { gte: now, lte: dueSoon } },
        ],
      },
      include: {
        customer: {
          select: { id: true, name: true, email: true, company: true },
        },
        reminders: {
          select: { type: true },
        },
      },
      orderBy: { dueDate: 'asc' },
    });
  }

  async hasReminderOfType(invoiceId: string, type: ReminderType) {
    const count = await prisma.reminder.count({
      where: { invoiceId, type },
    });

    return count > 0;
  }

  async findAll(params: {
    skip: number;
    take: number;
    where: Prisma.ReminderWhereInput;
  }) {
    const [data, total] = await Promise.all([
      prisma.reminder.findMany({
        where: params.where,
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: 'desc' },
        include: this.defaultInclude(),
      }),
      prisma.reminder.count({ where: params.where }),
    ]);

    return { data, total };
  }

  private defaultInclude() {
    return {
      invoice: {
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          dueDate: true,
          balanceDue: true,
          currency: true,
          customer: {
            select: { id: true, name: true, email: true, company: true },
          },
        },
      },
      sentBy: {
        select: { id: true, name: true, email: true },
      },
    };
  }
}

export const reminderRepository = new ReminderRepository();
