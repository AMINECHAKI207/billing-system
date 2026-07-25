import { prisma } from '@config/database';
import { Invoice, InvoiceStatus, Prisma } from '@prisma/client';

export class InvoiceRepository {
  async findCustomerById(id: string, accessWhere: Prisma.CustomerWhereInput = {}) {
    return prisma.customer.findFirst({ where: { id, AND: [accessWhere] } });
  }

  async create(data: Prisma.InvoiceUncheckedCreateInput): Promise<Invoice> {
    return prisma.invoice.create({
      data,
      include: this.defaultInclude(),
    });
  }

  async findById(id: string, accessWhere: Prisma.InvoiceWhereInput = {}) {
    return prisma.invoice.findFirst({
      where: { id, AND: [accessWhere] },
      include: this.defaultInclude(),
    });
  }

  async updateStatus(id: string, status: InvoiceStatus) {
    return prisma.invoice.update({
      where: { id },
      data: {
        status,
        sentAt: status === InvoiceStatus.SENT ? new Date() : undefined,
        paidAt: status === InvoiceStatus.PAID ? new Date() : undefined,
      },
      include: this.defaultInclude(),
    });
  }

  async updateDraftInvoice(id: string, data: Prisma.InvoiceUncheckedUpdateInput) {
    return prisma.$transaction(async (tx) => {
      await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });

      return tx.invoice.update({
        where: { id },
        data,
        include: this.defaultInclude(),
      });
    });
  }

  async markExpiredInvoicesOverdue(now = new Date()) {
    return prisma.invoice.updateMany({
      where: {
        dueDate: { lt: now },
        balanceDue: { gt: 0 },
        status: {
          in: [InvoiceStatus.SENT, InvoiceStatus.PARTIALLY_PAID],
        },
      },
      data: { status: InvoiceStatus.OVERDUE },
    });
  }

  async findAll(params: {
    skip: number;
    take: number;
    where: Prisma.InvoiceWhereInput;
    orderBy: Prisma.InvoiceOrderByWithRelationInput;
  }) {
    const [data, total] = await Promise.all([
      prisma.invoice.findMany({
        where: params.where,
        skip: params.skip,
        take: params.take,
        orderBy: params.orderBy,
        include: {
          customer: {
            select: { id: true, name: true, email: true, company: true, country: true, countryCode: true },
          },
          createdBy: {
            select: { id: true, name: true, email: true },
          },
          _count: {
            select: { items: true, payments: true, reminders: true },
          },
        },
      }),
      prisma.invoice.count({ where: params.where }),
    ]);

    return { data, total };
  }

  async addPaymentAndRefreshInvoice(params: {
    invoiceId: string;
    recordedById: string;
    amount: number;
    paymentDate: Date;
    method: Prisma.PaymentUncheckedCreateInput['method'];
    reference?: string | null;
    notes?: string | null;
    amountPaid: number;
    balanceDue: number;
    status: InvoiceStatus;
    paidAt?: Date | null;
  }) {
    return prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          invoiceId: params.invoiceId,
          recordedById: params.recordedById,
          amount: params.amount,
          paymentDate: params.paymentDate,
          method: params.method,
          reference: params.reference,
          notes: params.notes,
        },
      });

      const invoice = await tx.invoice.update({
        where: { id: params.invoiceId },
        data: {
          amountPaid: params.amountPaid,
          balanceDue: params.balanceDue,
          status: params.status,
          paidAt: params.paidAt,
        },
        include: this.defaultInclude(),
      });

      return { payment, invoice };
    });
  }

  async createEmailLog(data: Prisma.InvoiceEmailLogUncheckedCreateInput) {
    return prisma.invoiceEmailLog.create({ data });
  }

  async signInvoice(params: {
    invoiceId: string;
    signedById: string;
    signatureUrl: string;
    stampUrl: string;
  }) {
    return prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: params.invoiceId },
        select: { id: true, isSigned: true },
      });

      if (!invoice) {
        return null;
      }

      if (invoice.isSigned) {
        return 'ALREADY_SIGNED' as const;
      }

      return tx.invoice.update({
        where: { id: params.invoiceId },
        data: {
          isSigned: true,
          signedAt: new Date(),
          signedById: params.signedById,
          signatureUrl: params.signatureUrl,
          stampUrl: params.stampUrl,
        },
        include: this.defaultInclude(),
      });
    });
  }

  async cancelInvoiceSignature(invoiceId: string) {
    return prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        select: { id: true, isSigned: true },
      });

      if (!invoice) {
        return null;
      }

      if (!invoice.isSigned) {
        return 'NOT_SIGNED' as const;
      }

      return tx.invoice.update({
        where: { id: invoiceId },
        data: {
          isSigned: false,
          signedAt: null,
          signedById: null,
          signatureUrl: null,
          stampUrl: null,
        },
        include: this.defaultInclude(),
      });
    });
  }

  async getDashboardStats(params: { dateFrom: Date; dateTo: Date; months: number }, accessWhere: Prisma.InvoiceWhereInput = {}) {
    const now = new Date();
    const soon = new Date(now);
    soon.setDate(soon.getDate() + 7);
    const monthBuckets = buildMonthBuckets(params.dateTo, params.months);
    const invoiceWhere: Prisma.InvoiceWhereInput = {
      AND: [accessWhere],
      status: { not: InvoiceStatus.CANCELLED },
      issueDate: {
        gte: params.dateFrom,
        lte: params.dateTo,
      },
    };

    const [
      totalInvoices,
      paidInvoices,
      unpaidInvoices,
      overdueInvoices,
      totalClients,
      invoiceRows,
      recentPayments,
      upcomingDeadlines,
    ] = await Promise.all([
        prisma.invoice.count({ where: invoiceWhere }),
        prisma.invoice.count({ where: { ...invoiceWhere, status: InvoiceStatus.PAID } }),
        prisma.invoice.count({
          where: {
            ...invoiceWhere,
            balanceDue: { gt: 0 },
            status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.PAID, InvoiceStatus.CANCELLED] },
          },
        }),
        prisma.invoice.count({
          where: {
            ...invoiceWhere,
            balanceDue: { gt: 0 },
            dueDate: { lt: now },
            status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.PAID, InvoiceStatus.CANCELLED] },
          },
        }),
        prisma.customer.count({
          where: {
            invoices: {
              some: invoiceWhere,
            },
          },
        }),
        prisma.invoice.findMany({
          where: invoiceWhere,
          select: {
            id: true,
            invoiceNumber: true,
            status: true,
            total: true,
            amountPaid: true,
            balanceDue: true,
            dueDate: true,
            issueDate: true,
            currency: true,
            customer: { select: { id: true, name: true, company: true } },
          },
        }),
        prisma.payment.findMany({
          where: {
            paymentDate: {
              gte: params.dateFrom,
              lte: params.dateTo,
            },
          },
          orderBy: { paymentDate: 'desc' },
          take: 8,
          select: {
            id: true,
            amount: true,
            paymentDate: true,
            method: true,
            reference: true,
            invoice: {
              select: {
                id: true,
                invoiceNumber: true,
                currency: true,
                customer: { select: { name: true, company: true } },
              },
            },
          },
        }),
        prisma.invoice.findMany({
          where: {
            status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.PAID, InvoiceStatus.CANCELLED] },
            balanceDue: { gt: 0 },
            dueDate: {
              gte: now,
              lte: soon,
            },
          },
          orderBy: { dueDate: 'asc' },
          take: 8,
          select: {
            id: true,
            invoiceNumber: true,
            dueDate: true,
            balanceDue: true,
            total: true,
            currency: true,
            status: true,
            customer: { select: { name: true, company: true } },
          },
        }),
      ]);

    const totals = invoiceRows.reduce(
      (acc, invoice) => {
        if (invoice.status === InvoiceStatus.DRAFT) return acc;

        const total = Number(invoice.total);
        const paid = Number(invoice.amountPaid);
        const balance = Number(invoice.balanceDue);
        acc.totalRevenue += total;
        acc.totalPaid += paid;
        acc.totalUnpaid += balance;
        if (balance > 0 && invoice.dueDate < now) acc.overdueAmount += balance;
        if (balance > 0 && invoice.dueDate >= now && invoice.dueDate <= soon) {
          acc.dueSoonAmount += balance;
        }
        return acc;
      },
      { totalRevenue: 0, totalPaid: 0, totalUnpaid: 0, overdueAmount: 0, dueSoonAmount: 0 }
    );

    const unpaidByCustomer = invoiceRows.reduce<Record<string, { customer: string; unpaid: number }>>(
      (acc, invoice) => {
        const balance = Number(invoice.balanceDue);
        if (balance <= 0) return acc;

        const key = invoice.customer.id;
        acc[key] ??= {
          customer: invoice.customer.company ?? invoice.customer.name,
          unpaid: 0,
        };
        acc[key].unpaid += balance;
        return acc;
      },
      {}
    );
    const monthlyRevenue = monthBuckets.map((bucket) => {
      const matchingInvoices = invoiceRows.filter(
        (invoice) =>
          invoice.status !== InvoiceStatus.DRAFT &&
          invoice.issueDate >= bucket.start &&
          invoice.issueDate < bucket.end
      );

      return {
        month: bucket.label,
        revenue: matchingInvoices.reduce((sum, invoice) => sum + Number(invoice.total), 0),
        unpaid: matchingInvoices.reduce((sum, invoice) => sum + Number(invoice.balanceDue), 0),
        invoiceCount: matchingInvoices.length,
      };
    });
    const revenueThisMonth = monthlyRevenue.at(-1)?.revenue ?? 0;
    const revenueLastMonth = monthlyRevenue.at(-2)?.revenue ?? 0;
    const invoiceStatusCounts = Object.values(InvoiceStatus).map((status) => {
      const matchingInvoices = invoiceRows.filter((invoice) => invoice.status === status);

      return {
        status,
        count: matchingInvoices.length,
        amount: matchingInvoices.reduce((sum, invoice) => sum + Number(invoice.total), 0),
      };
    });
    const topClients = Object.values(
      invoiceRows.reduce<
        Record<string, { customer: string; revenue: number; invoiceCount: number }>
      >((acc, invoice) => {
        if (invoice.status === InvoiceStatus.DRAFT) return acc;

        const key = invoice.customer.id;
        acc[key] ??= {
          customer: invoice.customer.company ?? invoice.customer.name,
          revenue: 0,
          invoiceCount: 0,
        };
        acc[key].revenue += Number(invoice.total);
        acc[key].invoiceCount += 1;
        return acc;
      }, {})
    )
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    return {
      totalInvoices,
      totalClients,
      paidInvoices,
      unpaidInvoices,
      overdueInvoices,
      revenueThisMonth,
      revenueLastMonth,
      dateRange: {
        from: params.dateFrom.toISOString(),
        to: params.dateTo.toISOString(),
      },
      ...totals,
      monthlyRevenue,
      invoiceStatusCounts,
      topClients,
      recentPayments: recentPayments.map((payment) => ({
        id: payment.id,
        amount: Number(payment.amount),
        paymentDate: payment.paymentDate.toISOString(),
        method: payment.method,
        reference: payment.reference,
        invoiceId: payment.invoice.id,
        invoiceNumber: payment.invoice.invoiceNumber,
        customer: payment.invoice.customer.company ?? payment.invoice.customer.name,
        currency: payment.invoice.currency,
      })),
      upcomingDeadlines: upcomingDeadlines.map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        customer: invoice.customer.company ?? invoice.customer.name,
        dueDate: invoice.dueDate.toISOString(),
        balanceDue: Number(invoice.balanceDue),
        total: Number(invoice.total),
        currency: invoice.currency,
        status: invoice.status,
      })),
      unpaidByCustomer: Object.values(unpaidByCustomer).sort((a, b) => b.unpaid - a.unpaid),
    };
  }

  private defaultInclude() {
    return {
      customer: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          company: true,
          taxNumber: true,
          country: true,
          countryCode: true,
        },
      },
      createdBy: {
        select: { id: true, name: true, email: true },
      },
      signedBy: {
        select: { id: true, name: true, email: true },
      },
      items: {
        orderBy: { sortOrder: 'asc' as const },
      },
      payments: {
        orderBy: { paymentDate: 'desc' as const },
      },
      reminders: {
        orderBy: { createdAt: 'desc' as const },
        include: {
          sentBy: {
            select: { id: true, name: true, email: true },
          },
        },
      },
      emailLogs: {
        orderBy: { createdAt: 'desc' as const },
        include: {
          sentBy: {
            select: { id: true, name: true, email: true },
          },
        },
      },
    };
  }
}

function buildMonthBuckets(now: Date, months: number) {
  return Array.from({ length: months }, (_, index) => {
    const start = new Date(now.getFullYear(), now.getMonth() - (months - 1 - index), 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    const label = new Intl.DateTimeFormat('fr-MA', { month: 'short' }).format(start);

    return { start, end, label };
  });
}

export const invoiceRepository = new InvoiceRepository();
