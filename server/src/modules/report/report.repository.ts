import { prisma } from '@config/database';
import { InvoiceStatus } from '@prisma/client';

export class ReportRepository {
  async findOpenReceivables() {
    return prisma.invoice.findMany({
      where: {
        balanceDue: { gt: 0 },
        status: { notIn: [InvoiceStatus.PAID, InvoiceStatus.CANCELLED] },
      },
      select: {
        id: true,
        invoiceNumber: true,
        dueDate: true,
        balanceDue: true,
        currency: true,
        status: true,
        customer: {
          select: { id: true, name: true, company: true, email: true },
        },
      },
      orderBy: { dueDate: 'asc' },
    });
  }

  async findTaxInvoices(params: { dateFrom: Date; dateTo: Date }) {
    return prisma.invoice.findMany({
      where: {
        status: { not: InvoiceStatus.CANCELLED },
        issueDate: {
          gte: params.dateFrom,
          lte: params.dateTo,
        },
      },
      select: {
        id: true,
        invoiceNumber: true,
        issueDate: true,
        status: true,
        subtotal: true,
        taxRate: true,
        taxAmount: true,
        discount: true,
        total: true,
        amountPaid: true,
        balanceDue: true,
        currency: true,
        customer: {
          select: { id: true, name: true, company: true, email: true },
        },
      },
      orderBy: { issueDate: 'asc' },
    });
  }
}

export const reportRepository = new ReportRepository();
