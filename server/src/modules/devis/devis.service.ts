import { ApiError } from '@utils/ApiError';
import { logger } from '@config/logger';
import { sendEmail } from '@services/email.service';
import { generateDevisNumber } from '@utils/devisNumber';
import { parsePagination, parseSort } from '@utils/pagination';
import { DevisStatus, PermissionScope, Prisma, Role } from '@prisma/client';
import { settingsService } from '@modules/settings/settings.service';
import { rbacService } from '@modules/rbac/rbac.service';
import { customerAccessWhere, devisAccessWhere } from '@modules/rbac/accessScope';
import { getCountryName, isValidCountryCode, normalizeCountryCode } from '@utils/countries';
import { renderDevisPdfBuffer } from './devis.pdf';
import { CreateDevisInput, DevisQueryInput, UpdateDevisInput } from './devis.schema';
import { devisRepository } from './devis.repository';

export class DevisService {
  async createDevis(user: { id: string; role: Role }, scope: PermissionScope, data: CreateDevisInput) {
    const customer = await devisRepository.findCustomerById(data.customerId, customerAccessWhere(user.id, scope));
    if (!customer) throw ApiError.notFound('Customer');

    const vat = await this.resolveDevisVat(customer, data, user);
    this.assertValidDates(data.issueDate, data.validUntil);

    const totals = this.calculateDevisTotals(data, vat.rate);
    const devisNumber = await generateDevisNumber();
    const status = this.resolveInitialStatus(data.status);
    await this.assertNoApprovedDuplicateCatalog(data.customerId, data.items);

    const devis = await devisRepository.create({
      devisNumber,
      companyId: 1,
      customerId: data.customerId,
      createdById: user.id,
      status,
      issueDate: new Date(data.issueDate),
      validUntil: new Date(data.validUntil),
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
      notes: data.notes,
      terms: data.terms,
      currency: data.currency,
      sentAt: status === DevisStatus.SENT ? new Date() : undefined,
      approvedAt: status === DevisStatus.APPROVED ? new Date() : undefined,
      items: {
        create: totals.items.map((item, index) => ({
          description: item.description,
          unit: item.unit,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          taxRate: item.taxRate,
          lineTotal: item.lineTotal,
          sortOrder: index + 1,
        })),
      },
    });
    logger.info('Devis audit', { action: 'creation', devisId: devis.id, devisNumber: devis.devisNumber, userId: user.id });
    return devis;
  }

  async getDevis(userId: string, scope: PermissionScope, query: DevisQueryInput) {
    await devisRepository.markExpiredDevis();

    const { skip, limit, page } = parsePagination({ page: query.page, limit: query.limit });
    const { sortBy, sortOrder } = parseSort(
      { sortBy: query.sortBy, sortOrder: query.sortOrder },
      ['createdAt', 'issueDate', 'validUntil', 'total', 'devisNumber'],
      'createdAt'
    );

    const where: Prisma.DevisWhereInput = {
      AND: [devisAccessWhere(userId, scope)],
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
          { devisNumber: { contains: query.search, mode: 'insensitive' } },
          { customer: { name: { contains: query.search, mode: 'insensitive' } } },
          { customer: { email: { contains: query.search, mode: 'insensitive' } } },
          { customer: { phone: { contains: query.search, mode: 'insensitive' } } },
          { customer: { company: { contains: query.search, mode: 'insensitive' } } },
          { customer: { taxNumber: { contains: query.search, mode: 'insensitive' } } },
        ],
      }),
    };

    const { data, total } = await devisRepository.findAll({
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

  async getDevisById(id: string, userId: string, scope: PermissionScope) {
    await devisRepository.markExpiredDevis();
    const devis = await devisRepository.findById(id, devisAccessWhere(userId, scope));
    if (!devis) throw ApiError.notFound('Devis');
    return devis;
  }

  async updateDevis(id: string, user: { id: string; role: Role }, scope: PermissionScope, data: UpdateDevisInput) {
    const devis = await this.getDevisById(id, user.id, scope);
    if (devis.status !== DevisStatus.DRAFT) {
      throw ApiError.badRequest('Only draft quotes can be edited');
    }

    const customer = await devisRepository.findCustomerById(data.customerId, customerAccessWhere(user.id, scope));
    if (!customer) throw ApiError.notFound('Customer');

    const vat = await this.resolveDevisVat(customer, data, user);
    this.assertValidDates(data.issueDate, data.validUntil);
    const totals = this.calculateDevisTotals(data, vat.rate);

    const updated = await devisRepository.updateDraftDevis(id, {
      customerId: data.customerId,
      issueDate: new Date(data.issueDate),
      validUntil: new Date(data.validUntil),
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
      notes: data.notes,
      terms: data.terms,
      currency: data.currency,
      items: {
        create: totals.items.map((item, index) => ({
          description: item.description,
          unit: item.unit,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          taxRate: item.taxRate,
          lineTotal: item.lineTotal,
          sortOrder: index + 1,
        })),
      },
    });
    logger.info('Devis audit', { action: 'update', devisId: updated.id, devisNumber: updated.devisNumber, userId: user.id });
    return updated;
  }

  async updateStatus(id: string, userId: string, scope: PermissionScope, status: DevisStatus) {
    const devis = await this.getDevisById(id, userId, scope);
    if (devis.status === status) return devis;
    if (devis.status === DevisStatus.CONVERTED) throw ApiError.badRequest('Converted quotes cannot be changed');
    if (devis.status === DevisStatus.REJECTED && status !== DevisStatus.REJECTED) {
      throw ApiError.badRequest('Rejected quotes cannot be reopened');
    }
    if (devis.status === DevisStatus.EXPIRED && status !== DevisStatus.EXPIRED) {
      throw ApiError.badRequest('Expired quotes cannot be changed without a new draft');
    }
    if (devis.status === DevisStatus.DRAFT && status !== DevisStatus.SENT && status !== DevisStatus.REJECTED) {
      throw ApiError.badRequest('Draft quotes can only be sent or rejected');
    }
    if (devis.status === DevisStatus.SENT && status !== DevisStatus.APPROVED && status !== DevisStatus.REJECTED) {
      throw ApiError.badRequest('Sent quotes can only be approved or rejected');
    }
    if (devis.status === DevisStatus.APPROVED && status !== DevisStatus.REJECTED) {
      throw ApiError.badRequest('Approved quotes can only be rejected or converted');
    }
    if (status === DevisStatus.APPROVED) {
      await this.assertNoApprovedDuplicateCatalog(devis.customerId, devis.items, devis.id);
    }

    const updated = await devisRepository.updateStatus(id, status);
    logger.info('Devis audit', {
      action: status === DevisStatus.APPROVED ? 'approval' : status === DevisStatus.REJECTED ? 'rejection' : 'status_update',
      devisId: updated.id,
      devisNumber: updated.devisNumber,
      status,
      userId,
    });
    return updated;
  }

  async deleteDevis(id: string, userId: string, scope: PermissionScope) {
    const devis = await this.getDevisById(id, userId, scope);
    if (devis.status !== DevisStatus.DRAFT) {
      throw ApiError.badRequest('Only draft quotes can be deleted');
    }
    await devisRepository.deleteDraft(id);
    logger.info('Devis audit', { action: 'delete', devisId: id, devisNumber: devis.devisNumber, userId });
  }

  async deleteDraftDevis(userId: string, scope: PermissionScope) {
    const result = await devisRepository.deleteDrafts(devisAccessWhere(userId, scope));
    logger.info('Devis audit', { action: 'bulk_delete_drafts', deletedCount: result.count, userId });
    return { deletedCount: result.count };
  }

  async signDevis(id: string, signedById: string, scope: PermissionScope) {
    const devis = await this.getDevisById(id, signedById, scope);
    if (
      devis.status !== DevisStatus.DRAFT &&
      devis.status !== DevisStatus.APPROVED &&
      devis.status !== DevisStatus.CONVERTED
    ) {
      throw ApiError.badRequest('Only draft, approved or converted quotes can be signed');
    }

    const company = await settingsService.getCompanySettings();
    if (!company.signatureUrl || !company.stampUrl) {
      throw ApiError.badRequest('Configure the signature and stamp before signing this quote.');
    }

    const result = await devisRepository.signDevis({
      devisId: id,
      signedById,
      signatureUrl: company.signatureUrl,
      stampUrl: company.stampUrl,
    });

    if (!result) throw ApiError.notFound('Devis');
    if (result === 'ALREADY_SIGNED') throw ApiError.conflict('This quote is already signed');

    logger.info('Devis audit', {
      action: 'signature',
      devisId: result.id,
      devisNumber: result.devisNumber,
      userId: signedById,
    });
    return result;
  }

  async cancelDevisSignature(id: string, userId: string, scope: PermissionScope) {
    await this.getDevisById(id, userId, scope);

    const result = await devisRepository.cancelDevisSignature(id);
    if (!result) throw ApiError.notFound('Devis');
    if (result === 'NOT_SIGNED') throw ApiError.conflict('This quote is not signed');

    logger.info('Devis audit', {
      action: 'signature_cancel',
      devisId: result.id,
      devisNumber: result.devisNumber,
      userId,
    });
    return result;
  }

  async convertToInvoice(id: string, userId: string, scope: PermissionScope) {
    await this.getDevisById(id, userId, scope);
    if (!(await rbacService.userHasPermission(userId, 'invoices.create'))) {
      throw ApiError.forbidden('Missing permission: invoices.create');
    }

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);
    const result = await devisRepository.convertToInvoice(id, dueDate);

    if (!result) throw ApiError.notFound('Devis');
    if (result === 'INVALID_STATUS') throw ApiError.badRequest('Only approved quotes can be converted to invoices');
    if (result === 'ALREADY_CONVERTED') throw ApiError.conflict('This quote has already been converted');

    logger.info('Devis audit', {
      action: 'conversion',
      devisId: result.devis.id,
      devisNumber: result.devis.devisNumber,
      invoiceId: result.invoice.id,
      invoiceNumber: result.invoice.invoiceNumber,
      userId,
    });
    return result;
  }

  async sendDevisEmail(
    id: string,
    userId: string,
    scope: PermissionScope,
    data: {
      recipientEmail?: string | null;
      subject?: string | null;
      message?: string | null;
      pdfLanguage?: 'fr' | 'en' | 'ar' | null;
    }
  ) {
    const devis = await this.getDevisById(id, userId, scope);

    if (devis.status === DevisStatus.REJECTED) {
      throw ApiError.badRequest('Cannot email a rejected quote');
    }

    const company = await settingsService.getCompanySettings();
    const recipientEmail = data.recipientEmail?.trim() || devis.customer.email?.trim();
    if (!recipientEmail) {
      throw ApiError.badRequest('Recipient email is required.');
    }

    const subject = sanitizeEmailSubject(data.subject?.trim() || `Devis ${devis.devisNumber}`);
    const text = sanitizeEmailText(
      data.message?.trim()
      || [
        `Bonjour ${devis.customer.name},`,
        '',
        `Veuillez trouver ci-joint le devis ${devis.devisNumber}.`,
        `Montant total: ${formatDevisEmailCurrency(Number(devis.total), devis.currency)}.`,
        `Valable jusqu'au: ${formatDevisEmailDate(devis.validUntil)}.`,
        '',
        'Cordialement,',
        company.name,
      ].join('\n')
    );
    const pdf = await renderDevisPdfBuffer(devis, company);

    try {
      const delivery = await sendEmail({
        to: recipientEmail,
        subject,
        text,
        attachments: [
          {
            filename: `${safeDevisFileName(devis.devisNumber)}.pdf`,
            content: pdf,
            contentType: 'application/pdf',
          },
        ],
      });

      const updatedDevis =
        devis.status === DevisStatus.DRAFT
          ? await devisRepository.updateStatus(id, DevisStatus.SENT)
          : devis;

      logger.info('Devis email sent', {
        devisId: devis.id,
        devisNumber: devis.devisNumber,
        userId,
        recipientEmail,
        deliveryMode: delivery.mode,
      });

      return {
        devis: updatedDevis,
        email: { to: recipientEmail, subject },
        delivery,
      };
    } catch (error) {
      logger.error('Failed to send devis email', {
        devisId: devis.id,
        devisNumber: devis.devisNumber,
        userId,
        recipientEmail,
        error: error instanceof Error ? error.message : 'Unknown email error',
      });
      throw error;
    }
  }

  private async resolveDevisVat(
    customer: Awaited<ReturnType<typeof devisRepository.findCustomerById>>,
    data: CreateDevisInput | UpdateDevisInput,
    user: { id: string; role: Role }
  ) {
    if (!customer) throw ApiError.notFound('Customer');
    if (!customer.country?.trim() || !customer.countryCode?.trim()) {
      throw ApiError.badRequest("Please select the customer's country.");
    }

    const countryCode = normalizeCountryCode(customer.countryCode);
    if (!isValidCountryCode(countryCode)) throw ApiError.badRequest("Please select the customer's country.");

    const settings = await settingsService.getCompanySettings();
    const automaticRate = settings.vatEnabled && countryCode === 'MA' ? Number(settings.moroccoVatRate) : 0;
    const requestedRate = data.taxRate;
    const hasOverride = requestedRate !== undefined && Math.abs(Number(requestedRate) - automaticRate) > 0.0001;

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

    if (!data.vatOverrideReason?.trim()) throw ApiError.badRequest('VAT override reason is required.');

    return {
      rate: Number(requestedRate),
      country: customer.country.trim() || getCountryName(countryCode),
      countryCode,
      overridden: true,
      overrideReason: data.vatOverrideReason.trim(),
    };
  }

  private calculateDevisTotals(data: CreateDevisInput | UpdateDevisInput, vatRate: number) {
    const items = data.items.map((item) => {
      const lineBase = Math.max(0, roundMoney(item.quantity * item.unitPrice - item.discount));
      const taxAmount = roundMoney(lineBase * (vatRate / 100));

      return {
        ...item,
        taxRate: vatRate,
        lineTotal: roundMoney(lineBase + taxAmount),
      };
    });

    const subtotal = roundMoney(
      items.reduce((sum, item) => sum + Math.max(0, item.quantity * item.unitPrice - item.discount), 0)
    );
    const taxAmount = roundMoney(items.reduce((sum, item) => sum + (item.lineTotal - Math.max(0, item.quantity * item.unitPrice - item.discount)), 0));
    const total = Math.max(0, roundMoney(subtotal + taxAmount - data.discount));

    return { items, subtotal, taxAmount, total };
  }

  private resolveInitialStatus(requestedStatus: DevisStatus | undefined) {
    if (!requestedStatus) return DevisStatus.DRAFT;
    if (
      requestedStatus === DevisStatus.DRAFT ||
      requestedStatus === DevisStatus.SENT ||
      requestedStatus === DevisStatus.APPROVED
    ) {
      return requestedStatus;
    }
    return DevisStatus.DRAFT;
  }

  private assertValidDates(issueDate: string, validUntil: string) {
    if (new Date(validUntil) < new Date(issueDate)) {
      throw ApiError.badRequest('Valid-until date must be after issue date');
    }
  }

  private async assertNoApprovedDuplicateCatalog(
    customerId: string,
    items: Array<{ description: string; unit?: string | null }>,
    excludeId?: string
  ) {
    const catalogSignature = buildCatalogSignature(items);
    const approvedQuotes = await devisRepository.findApprovedByCustomer(customerId, excludeId);
    const duplicate = approvedQuotes.find((devis) => buildCatalogSignature(devis.items) === catalogSignature);
    if (duplicate) {
      throw ApiError.conflict('An approved quote already exists for this customer and catalog');
    }
  }
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function buildCatalogSignature(items: Array<{ description: string; unit?: string | null }>) {
  return items
    .map((item) => `${normalizeCatalogValue(item.description)}|${normalizeCatalogValue(item.unit ?? '')}`)
    .sort()
    .join('||');
}

function normalizeCatalogValue(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export const devisService = new DevisService();

function safeDevisFileName(value: string) {
  return value.replace(/[^a-z0-9_.-]+/gi, '-').replace(/^-+|-+$/g, '');
}

function sanitizeEmailText(value: string) {
  return value.replace(/\0/g, '').trim();
}

function sanitizeEmailSubject(value: string) {
  return sanitizeEmailText(value).replace(/[\r\n]+/g, ' ').slice(0, 255);
}

function formatDevisEmailCurrency(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function formatDevisEmailDate(date: Date) {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}
