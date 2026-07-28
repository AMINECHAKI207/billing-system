import { ApiError } from '@utils/ApiError';
import { generateInvoiceNumber } from '@utils/invoiceNumber';
import { parsePagination, parseSort } from '@utils/pagination';
import { sendEmail } from '@services/email.service';
import { InvoiceStatus, PermissionScope, Prisma, Role } from '@prisma/client';
import { settingsService } from '@modules/settings/settings.service';
import { rbacService } from '@modules/rbac/rbac.service';
import { customerAccessWhere, invoiceAccessWhere } from '@modules/rbac/accessScope';
import { invoiceRepository } from './invoice.repository';
import { renderInvoicePdfBuffer } from './invoice.pdf';
import { renderInvoicesExcelBuffer } from './invoice.excel';
import { getCountryName, isValidCountryCode, normalizeCountryCode } from '@utils/countries';
import {
  AddPaymentInput,
  CreateInvoiceInput,
  DashboardQueryInput,
  InvoiceQueryInput,
  SendInvoiceEmailInput,
  UpdateInvoiceInput,
} from './invoice.schema';

export class InvoiceService {
  async createInvoice(user: { id: string; role: Role }, scope: PermissionScope, data: CreateInvoiceInput) {
    const customer = await invoiceRepository.findCustomerById(data.customerId, customerAccessWhere(user.id, scope));
    if (!customer) {
      throw ApiError.notFound('Customer');
    }
    const vat = await this.resolveInvoiceVat(customer, data, user);

    if (new Date(data.dueDate) < new Date(data.issueDate)) {
      throw ApiError.badRequest('Due date must be after issue date');
    }

    const totals = this.calculateInvoiceTotals(data, vat.rate);
    const invoiceNumber = await generateInvoiceNumber();
    const dueDate = new Date(data.dueDate);
    const status = this.resolveInitialStatus(data.status, totals.total, dueDate);

    return invoiceRepository.create({
      customerId: data.customerId,
      createdById: user.id,
      invoiceNumber,
      status,
      issueDate: new Date(data.issueDate),
      dueDate,
      subtotal: totals.subtotal,
      taxRate: vat.rate,
      taxAmount: totals.taxAmount,
      customerCountry: vat.country,
      customerCountryCode: vat.countryCode,
      vatOverridden: vat.overridden,
      vatOverrideReason: vat.overrideReason,
      vatOverriddenAt: vat.overridden ? new Date() : undefined,
      vatOverriddenById: vat.overridden ? user.id : undefined,
      discount: data.discount,
      total: totals.total,
      amountPaid: 0,
      balanceDue: totals.total,
      notes: data.notes,
      terms: data.terms,
      currency: data.currency,
      sentAt: status === InvoiceStatus.SENT || status === InvoiceStatus.OVERDUE ? new Date() : undefined,
      items: {
        create: totals.items.map((item, index) => ({
          description: item.description,
          unit: item.unit,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxRate: item.taxRate,
          total: item.total,
          sortOrder: index + 1,
        })),
      },
    });
  }

  async getInvoices(userId: string, scope: PermissionScope, query: InvoiceQueryInput) {
    await invoiceRepository.markExpiredInvoicesOverdue();

    const { skip, limit, page } = parsePagination({ page: query.page, limit: query.limit });
    const { sortBy, sortOrder } = parseSort(
      { sortBy: query.sortBy, sortOrder: query.sortOrder },
      ['createdAt', 'issueDate', 'dueDate', 'total', 'balanceDue', 'invoiceNumber'],
      'createdAt'
    );

    const where = this.buildInvoiceWhere(userId, scope, query);

    const { data, total } = await invoiceRepository.findAll({
      skip,
      take: limit,
      where,
      orderBy: { [sortBy]: sortOrder },
    });

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async exportInvoicesExcel(userId: string, scope: PermissionScope, query: InvoiceQueryInput) {
    await invoiceRepository.markExpiredInvoicesOverdue();

    const { sortBy, sortOrder } = parseSort(
      { sortBy: query.sortBy, sortOrder: query.sortOrder },
      ['createdAt', 'issueDate', 'dueDate', 'total', 'balanceDue', 'invoiceNumber'],
      'createdAt'
    );
    const invoices = await invoiceRepository.findAllForExport({
      where: this.buildInvoiceWhere(userId, scope, query),
      orderBy: { [sortBy]: sortOrder },
    });

    return renderInvoicesExcelBuffer(invoices);
  }

  async getInvoiceById(id: string, userId: string, scope: PermissionScope) {
    await invoiceRepository.markExpiredInvoicesOverdue();

    const invoice = await invoiceRepository.findById(id, invoiceAccessWhere(userId, scope));
    if (!invoice) {
      throw ApiError.notFound('Invoice');
    }
    return invoice;
  }

  async updateInvoice(id: string, user: { id: string; role: Role }, scope: PermissionScope, data: UpdateInvoiceInput) {
    const invoice = await this.getInvoiceById(id, user.id, scope);

    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw ApiError.badRequest('Only draft invoices can be edited');
    }

    const customer = await invoiceRepository.findCustomerById(data.customerId, customerAccessWhere(user.id, scope));
    if (!customer) {
      throw ApiError.notFound('Customer');
    }
    const vat = await this.resolveInvoiceVat(customer, data, user);

    if (new Date(data.dueDate) < new Date(data.issueDate)) {
      throw ApiError.badRequest('Due date must be after issue date');
    }

    const totals = this.calculateInvoiceTotals(data, vat.rate);

    return invoiceRepository.updateDraftInvoice(id, {
      customerId: data.customerId,
      issueDate: new Date(data.issueDate),
      dueDate: new Date(data.dueDate),
      subtotal: totals.subtotal,
      taxRate: vat.rate,
      taxAmount: totals.taxAmount,
      customerCountry: vat.country,
      customerCountryCode: vat.countryCode,
      vatOverridden: vat.overridden,
      vatOverrideReason: vat.overrideReason,
      vatOverriddenAt: vat.overridden ? new Date() : null,
      vatOverriddenById: vat.overridden ? user.id : null,
      discount: data.discount,
      total: totals.total,
      amountPaid: 0,
      balanceDue: totals.total,
      notes: data.notes,
      terms: data.terms,
      currency: data.currency,
      items: {
        create: totals.items.map((item, index) => ({
          description: item.description,
          unit: item.unit,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxRate: item.taxRate,
          total: item.total,
          sortOrder: index + 1,
        })),
      },
    });
  }

  async updateStatus(id: string, userId: string, scope: PermissionScope, status: InvoiceStatus) {
    const invoice = await this.getInvoiceById(id, userId, scope);

    if (invoice.status === status) {
      return invoice;
    }

    if (invoice.status === InvoiceStatus.CANCELLED && status !== InvoiceStatus.CANCELLED) {
      throw ApiError.badRequest('Cancelled invoices cannot be reopened');
    }

    if (invoice.status === InvoiceStatus.PAID) {
      throw ApiError.badRequest('Paid invoices cannot be changed manually');
    }

    if (
      status === InvoiceStatus.PAID ||
      status === InvoiceStatus.PARTIALLY_PAID ||
      status === InvoiceStatus.OVERDUE
    ) {
      throw ApiError.badRequest('Paid, partially paid and overdue statuses are updated automatically');
    }

    if (invoice.status === InvoiceStatus.DRAFT && status !== InvoiceStatus.SENT && status !== InvoiceStatus.CANCELLED) {
      throw ApiError.badRequest('Draft invoices can only be sent or cancelled');
    }

    if (
      (invoice.status === InvoiceStatus.SENT ||
        invoice.status === InvoiceStatus.PARTIALLY_PAID ||
        invoice.status === InvoiceStatus.OVERDUE) &&
      status !== InvoiceStatus.CANCELLED
    ) {
      throw ApiError.badRequest('Open invoices can only be cancelled manually');
    }

    return invoiceRepository.updateStatus(id, status);
  }

  async addPayment(invoiceId: string, recordedById: string, scope: PermissionScope, data: AddPaymentInput) {
    const invoice = await this.getInvoiceById(invoiceId, recordedById, scope);

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw ApiError.badRequest('Cannot add payments to a cancelled invoice');
    }

    if (invoice.status === InvoiceStatus.DRAFT) {
      throw ApiError.badRequest('Send the invoice before recording payments');
    }

    if (invoice.status === InvoiceStatus.PAID) {
      throw ApiError.badRequest('Cannot add payments to an already paid invoice');
    }

    if (new Date(data.paymentDate) > new Date()) {
      throw ApiError.badRequest('Payment date cannot be in the future');
    }

    const balanceDue = Number(invoice.balanceDue);
    if (data.amount > balanceDue) {
      throw ApiError.badRequest('Payment amount cannot exceed the remaining balance');
    }

    const nextAmountPaid = Number(invoice.amountPaid) + data.amount;
    const nextBalanceDue = Math.max(0, Number(invoice.total) - nextAmountPaid);
    const nextStatus = this.resolvePaymentStatus(nextBalanceDue, invoice.dueDate);

    return invoiceRepository.addPaymentAndRefreshInvoice({
      invoiceId,
      recordedById,
      amount: data.amount,
      paymentDate: new Date(data.paymentDate),
      method: data.method,
      reference: data.reference,
      notes: data.notes,
      amountPaid: nextAmountPaid,
      balanceDue: nextBalanceDue,
      status: nextStatus,
      paidAt: nextStatus === InvoiceStatus.PAID ? new Date(data.paymentDate) : null,
    });
  }

  async getDashboardStats(userId: string, scope: PermissionScope, query: DashboardQueryInput = {}) {
    await invoiceRepository.markExpiredInvoicesOverdue();

    return invoiceRepository.getDashboardStats(resolveDashboardPeriod(query), invoiceAccessWhere(userId, scope));
  }

  async signInvoice(id: string, signedById: string, scope: PermissionScope) {
    await this.getInvoiceById(id, signedById, scope);
    const company = await settingsService.getCompanySettings();

    if (!company.signatureUrl || !company.stampUrl) {
      throw ApiError.badRequest('Configurez la signature et le tampon de l entreprise avant de signer.');
    }

    const result = await invoiceRepository.signInvoice({
      invoiceId: id,
      signedById,
      signatureUrl: company.signatureUrl,
      stampUrl: company.stampUrl,
    });

    if (!result) {
      throw ApiError.notFound('Invoice');
    }

    if (result === 'ALREADY_SIGNED') {
      throw ApiError.conflict('Invoice is already signed');
    }

    return result;
  }

  async cancelInvoiceSignature(id: string, userId: string, scope: PermissionScope) {
    await this.getInvoiceById(id, userId, scope);
    const result = await invoiceRepository.cancelInvoiceSignature(id);

    if (!result) {
      throw ApiError.notFound('Invoice');
    }

    if (result === 'NOT_SIGNED') {
      throw ApiError.conflict('Invoice is not signed');
    }

    return result;
  }

  async sendInvoiceEmail(id: string, sentById: string, scope: PermissionScope, data: SendInvoiceEmailInput) {
    const invoice = await this.getInvoiceById(id, sentById, scope);

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw ApiError.badRequest('Cannot email a cancelled invoice');
    }

    const company = await settingsService.getCompanySettings();
    const recipientEmail = data.recipientEmail ?? invoice.customer.email;
    const subject = data.subject ?? `Facture ${invoice.invoiceNumber}`;
    const text =
      data.message ??
      [
        `Bonjour ${invoice.customer.name},`,
        '',
        `Veuillez trouver ci-joint la facture ${invoice.invoiceNumber}.`,
        `Montant total: ${formatEmailCurrency(Number(invoice.total), invoice.currency)}.`,
        `Reste a payer: ${formatEmailCurrency(Number(invoice.balanceDue), invoice.currency)}.`,
        `Date d'echeance: ${formatEmailDate(invoice.dueDate)}.`,
        '',
        'Cordialement,',
        company.name,
      ].join('\n');
    const pdf = await renderInvoicePdfBuffer(invoice, company);

    let delivery: Awaited<ReturnType<typeof sendEmail>>;

    try {
      delivery = await sendEmail({
        to: recipientEmail,
        subject,
        text,
        attachments: [
          {
            filename: `${invoice.invoiceNumber}.pdf`,
            content: pdf,
            contentType: 'application/pdf',
          },
        ],
      });
    } catch (error) {
      await invoiceRepository.createEmailLog({
        invoiceId: id,
        sentById,
        recipientEmail,
        subject,
        message: text,
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : 'Unknown email error',
      });
      throw error;
    }

    await invoiceRepository.createEmailLog({
      invoiceId: id,
      sentById,
      recipientEmail,
      subject,
      message: text,
      status: 'SENT',
      deliveryMode: delivery.mode,
      messageId: delivery.messageId,
      filePath: delivery.filePath,
    });

    const updatedInvoice =
      invoice.status === InvoiceStatus.DRAFT
        ? await invoiceRepository.updateStatus(id, InvoiceStatus.SENT)
        : invoice;

    return {
      invoice: updatedInvoice,
      email: {
        to: recipientEmail,
        subject,
      },
      delivery,
    };
  }

  private buildInvoiceWhere(userId: string, scope: PermissionScope, query: InvoiceQueryInput): Prisma.InvoiceWhereInput {
    return {
      AND: [invoiceAccessWhere(userId, scope)],
      ...(query.status && { status: query.status }),
      ...(query.customerId && { customerId: query.customerId }),
      ...((query.dateFrom || query.dateTo) && {
        issueDate: {
          ...(query.dateFrom && { gte: new Date(query.dateFrom) }),
          ...(query.dateTo && { lte: new Date(query.dateTo) }),
        },
      }),
      ...(query.search && {
        OR: [
          { invoiceNumber: { contains: query.search, mode: 'insensitive' } },
          { customer: { name: { contains: query.search, mode: 'insensitive' } } },
          { customer: { email: { contains: query.search, mode: 'insensitive' } } },
          { customer: { phone: { contains: query.search, mode: 'insensitive' } } },
          { customer: { company: { contains: query.search, mode: 'insensitive' } } },
          { customer: { taxNumber: { contains: query.search, mode: 'insensitive' } } },
        ],
      }),
    };
  }

  private async resolveInvoiceVat(
    customer: Awaited<ReturnType<typeof invoiceRepository.findCustomerById>>,
    data: CreateInvoiceInput | UpdateInvoiceInput,
    user: { id: string; role: Role }
  ) {
    if (!customer) throw ApiError.notFound('Customer');

    if (!customer.country?.trim() || !customer.countryCode?.trim()) {
      throw ApiError.badRequest("Please select the customer's country.");
    }

    const countryCode = normalizeCountryCode(customer.countryCode);
    if (!isValidCountryCode(countryCode)) {
      throw ApiError.badRequest("Please select the customer's country.");
    }

    const settings = await settingsService.getCompanySettings();
    const automaticRate =
      settings.vatEnabled && countryCode === 'MA' ? Number(settings.moroccoVatRate) : 0;
    const requestedRate = data.taxRate;
    const hasOverride =
      requestedRate !== undefined && Math.abs(Number(requestedRate) - automaticRate) > 0.0001;

    if (!hasOverride) {
      return {
        rate: automaticRate,
        country: customer.country.trim() || getCountryName(countryCode),
        countryCode,
        overridden: false,
        overrideReason: null,
      };
    }

    if (!(await rbacService.userHasPermission(user.id, 'invoices.override_vat'))) {
      throw ApiError.forbidden('Only an administrator can override VAT.');
    }

    if (!data.vatOverrideReason?.trim()) {
      throw ApiError.badRequest('VAT override reason is required.');
    }

    return {
      rate: Number(requestedRate),
      country: customer.country.trim() || getCountryName(countryCode),
      countryCode,
      overridden: true,
      overrideReason: data.vatOverrideReason.trim(),
    };
  }

  private calculateInvoiceTotals(data: CreateInvoiceInput | UpdateInvoiceInput, vatRate: number) {
    const items = data.items.map((item) => {
      const taxRate = vatRate;
      const lineSubtotal = roundMoney(item.quantity * item.unitPrice);
      const taxAmount = roundMoney(lineSubtotal * (taxRate / 100));

      return {
        ...item,
        taxRate,
        total: roundMoney(lineSubtotal + taxAmount),
      };
    });

    const subtotal = roundMoney(
      data.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
    );
    const taxAmount = roundMoney(
      items.reduce((sum, item) => sum + item.quantity * item.unitPrice * (item.taxRate / 100), 0)
    );
    const total = Math.max(0, roundMoney(subtotal + taxAmount - data.discount));

    return { items, subtotal, taxAmount, total };
  }

  private resolvePaymentStatus(balanceDue: number, dueDate: Date): InvoiceStatus {
    if (balanceDue <= 0) return InvoiceStatus.PAID;
    if (dueDate < new Date()) return InvoiceStatus.OVERDUE;
    return InvoiceStatus.PARTIALLY_PAID;
  }

  private resolveInitialStatus(
    requestedStatus: InvoiceStatus | undefined,
    total: number,
    dueDate: Date
  ): InvoiceStatus {
    if (requestedStatus === InvoiceStatus.CANCELLED) return InvoiceStatus.CANCELLED;
    if (requestedStatus === InvoiceStatus.PAID && total > 0) return InvoiceStatus.DRAFT;
    if (requestedStatus === InvoiceStatus.DRAFT || !requestedStatus) return InvoiceStatus.DRAFT;
    if (dueDate < new Date()) return InvoiceStatus.OVERDUE;
    return requestedStatus;
  }
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function resolveDashboardPeriod(query: DashboardQueryInput) {
  const now = new Date();
  const period = query.period ?? 'last_6_months';
  let start: Date;
  let end: Date;

  if (period === 'custom') {
    start = query.dateFrom ? startOfDay(new Date(query.dateFrom)) : new Date(now.getFullYear(), now.getMonth(), 1);
    end = query.dateTo ? endOfDay(new Date(query.dateTo)) : endOfDay(now);
  } else if (period === 'this_month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = endOfDay(now);
  } else if (period === 'last_3_months') {
    start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    end = endOfDay(now);
  } else if (period === 'this_year') {
    start = new Date(now.getFullYear(), 0, 1);
    end = endOfDay(now);
  } else {
    start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    end = endOfDay(now);
  }

  if (start > end) {
    throw ApiError.badRequest('Invalid dashboard date range');
  }

  return {
    dateFrom: start,
    dateTo: end,
    months: query.months ? Number(query.months) : 6,
  };
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

export const invoiceService = new InvoiceService();

function formatEmailCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat('fr-MA', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

function formatEmailDate(date: Date) {
  return new Intl.DateTimeFormat('fr-MA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
