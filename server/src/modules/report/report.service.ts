import { reportRepository } from './report.repository';
import { TaxSummaryQueryInput } from './report.schema';

type AgingBucketKey = 'notDue' | 'days1To30' | 'days31To60' | 'days61To90' | 'days90Plus';

const bucketLabels: Record<AgingBucketKey, string> = {
  notDue: 'Non echu',
  days1To30: '1-30 jours',
  days31To60: '31-60 jours',
  days61To90: '61-90 jours',
  days90Plus: '90+ jours',
};

export class ReportService {
  async getReceivablesAging() {
    const now = startOfDay(new Date());
    const invoices = await reportRepository.findOpenReceivables();
    const buckets = createEmptyBuckets();

    invoices.forEach((invoice) => {
      const daysLate = diffDays(now, startOfDay(invoice.dueDate));
      const bucketKey = getBucketKey(daysLate);
      const balanceDue = Number(invoice.balanceDue);

      buckets[bucketKey].amount += balanceDue;
      buckets[bucketKey].invoiceCount += 1;
      buckets[bucketKey].invoices.push({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        customer: invoice.customer.company ?? invoice.customer.name,
        dueDate: invoice.dueDate,
        daysLate: Math.max(0, daysLate),
        balanceDue,
        currency: invoice.currency,
        status: invoice.status,
      });
    });

    const bucketList = Object.entries(buckets).map(([key, value]) => ({
      key,
      label: bucketLabels[key as AgingBucketKey],
      ...value,
    }));

    return {
      generatedAt: new Date(),
      totalAmount: bucketList.reduce((sum, bucket) => sum + bucket.amount, 0),
      totalInvoices: bucketList.reduce((sum, bucket) => sum + bucket.invoiceCount, 0),
      buckets: bucketList,
    };
  }

  async getTaxSummary(query: TaxSummaryQueryInput) {
    const now = new Date();
    const dateFrom = query.dateFrom ? startOfDay(new Date(query.dateFrom)) : new Date(now.getFullYear(), 0, 1);
    const dateTo = query.dateTo ? endOfDay(new Date(query.dateTo)) : endOfDay(now);

    if (dateFrom > dateTo) {
      throw new Error('dateFrom must be before dateTo');
    }

    const invoices = await reportRepository.findTaxInvoices({ dateFrom, dateTo });
    const taxRates = new Map<
      string,
      {
        taxRate: number;
        invoiceCount: number;
        subtotal: number;
        discount: number;
        taxAmount: number;
        total: number;
      }
    >();

    const totals = invoices.reduce(
      (acc, invoice) => {
        const taxRate = Number(invoice.taxRate);
        const key = taxRate.toFixed(2);
        const subtotal = Number(invoice.subtotal);
        const discount = Number(invoice.discount);
        const taxAmount = Number(invoice.taxAmount);
        const total = Number(invoice.total);
        const amountPaid = Number(invoice.amountPaid);
        const balanceDue = Number(invoice.balanceDue);

        acc.subtotal += subtotal;
        acc.discount += discount;
        acc.taxAmount += taxAmount;
        acc.total += total;
        acc.amountPaid += amountPaid;
        acc.balanceDue += balanceDue;

        const rateBucket = taxRates.get(key) ?? {
          taxRate,
          invoiceCount: 0,
          subtotal: 0,
          discount: 0,
          taxAmount: 0,
          total: 0,
        };
        rateBucket.invoiceCount += 1;
        rateBucket.subtotal += subtotal;
        rateBucket.discount += discount;
        rateBucket.taxAmount += taxAmount;
        rateBucket.total += total;
        taxRates.set(key, rateBucket);

        return acc;
      },
      {
        invoiceCount: invoices.length,
        subtotal: 0,
        discount: 0,
        taxableBase: 0,
        taxAmount: 0,
        total: 0,
        amountPaid: 0,
        balanceDue: 0,
      }
    );

    totals.taxableBase = Math.max(0, totals.subtotal - totals.discount);

    return {
      generatedAt: new Date(),
      dateFrom,
      dateTo,
      totals,
      taxRates: Array.from(taxRates.values()).sort((left, right) => left.taxRate - right.taxRate),
      invoices: invoices.map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        issueDate: invoice.issueDate,
        customer: invoice.customer.company ?? invoice.customer.name,
        status: invoice.status,
        subtotal: Number(invoice.subtotal),
        discount: Number(invoice.discount),
        taxRate: Number(invoice.taxRate),
        taxAmount: Number(invoice.taxAmount),
        total: Number(invoice.total),
        amountPaid: Number(invoice.amountPaid),
        balanceDue: Number(invoice.balanceDue),
        currency: invoice.currency,
      })),
    };
  }
}

function createEmptyBuckets() {
  return Object.keys(bucketLabels).reduce(
    (acc, key) => ({
      ...acc,
      [key]: { amount: 0, invoiceCount: 0, invoices: [] },
    }),
    {} as Record<
      AgingBucketKey,
      {
        amount: number;
        invoiceCount: number;
        invoices: Array<{
          id: string;
          invoiceNumber: string;
          customer: string;
          dueDate: Date;
          daysLate: number;
          balanceDue: number;
          currency: string;
          status: string;
        }>;
      }
    >
  );
}

function getBucketKey(daysLate: number): AgingBucketKey {
  if (daysLate <= 0) return 'notDue';
  if (daysLate <= 30) return 'days1To30';
  if (daysLate <= 60) return 'days31To60';
  if (daysLate <= 90) return 'days61To90';
  return 'days90Plus';
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function diffDays(left: Date, right: Date) {
  return Math.floor((left.getTime() - right.getTime()) / (24 * 60 * 60 * 1000));
}

export const reportService = new ReportService();
