import { prisma } from '@config/database';
import { settingsService } from '@modules/settings/settings.service';
import { creditNoteAccessWhere, invoiceAccessWhere } from '@modules/rbac/accessScope';
import {
  CreditNoteRefundStatus,
  CreditNoteStatus,
  CreditNoteType,
  InvoiceStatus,
  PermissionScope,
  Prisma,
} from '@prisma/client';
import { sendEmail } from '@services/email.service';
import { ApiError } from '@utils/ApiError';
import { generateCreditNoteNumber } from '@utils/creditNoteNumber';
import { renderCreditNotePdfBuffer } from './creditNote.pdf';
import { creditNoteRepository } from './creditNote.repository';
import {
  CancelCreditNoteInput,
  CreditNoteReasonInput,
  CreditNoteReasonUpdateInput,
  CreateCreditNoteInput,
  CreditNoteQueryInput,
  RefundCreditNoteInput,
  SendCreditNoteEmailInput,
  UpdateCreditNoteInput,
} from './creditNote.schema';

export class CreditNoteService {
  async create(userId: string, scope: PermissionScope, data: CreateCreditNoteInput) {
    const invoice = await creditNoteRepository.findInvoiceById(data.invoiceId, invoiceAccessWhere(userId, scope));
    if (!invoice) throw ApiError.notFound('Invoice');
    this.assertInvoiceCanBeCredited(invoice.status);
    const resolvedReason = await this.resolveReasonForWrite(data.reasonId, data.reason);
    const reason = resolvedReason.reason;
    const reasonText = resolvedReason.explanation || reason.nameFr;

    const totals = this.resolveTotals({ ...data, reason: reasonText }, invoice);
    this.assertCreditWithinRemaining(totals.total, this.remainingCreditable(invoice));

    const creditNoteNumber = await generateCreditNoteNumber();
    const creditNote = await creditNoteRepository.create({
      creditNoteNumber,
      invoiceId: invoice.id,
      customerId: invoice.customerId,
      createdById: userId,
      type: data.type,
      status: CreditNoteStatus.DRAFT,
      issueDate: new Date(data.issueDate),
      reasonId: reason.id,
      reasonCodeSnapshot: reason.code,
      reasonNameSnapshot: this.reasonSnapshot(reason),
      reason: reasonText,
      internalComment: data.internalComment?.trim() || null,
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      total: totals.total,
      currency: invoice.currency,
      lines: { create: totals.lines },
      auditLogs: {
        create: {
          action: 'CREATED',
          actorId: userId,
          newValues: { total: totals.total, invoiceId: invoice.id, reasonId: reason.id, reasonCode: reason.code },
        },
      },
    });

    return this.withSummary(creditNote);
  }

  async getAll(userId: string, scope: PermissionScope, query: CreditNoteQueryInput) {
    const page = Number(query.page ?? 1);
    const limit = Math.min(Number(query.limit ?? 20), 100);
    const where = this.buildWhere(userId, scope, query);
    return creditNoteRepository.findAll({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
    });
  }

  async getReasons(includeInactive = false) {
    return creditNoteRepository.findReasons(includeInactive);
  }

  async createReason(userId: string, data: CreditNoteReasonInput) {
    const code = data.code.trim().toUpperCase();
    const existing = await creditNoteRepository.findReasonByCode(code);
    if (existing) {
      throw ApiError.conflict('A credit note reason with this code already exists');
    }

    const reason = await creditNoteRepository.createReason({
      code,
      nameFr: data.nameFr.trim(),
      nameEn: data.nameEn.trim(),
      nameAr: data.nameAr.trim(),
      description: data.description?.trim() || null,
      category: data.category.trim().toUpperCase(),
      isActive: data.isActive ?? true,
      isSystem: false,
      requiresComment: data.requiresComment ?? false,
      sortOrder: data.sortOrder ?? 500,
      createdById: userId,
    });
    return reason;
  }

  async updateReason(id: string, data: CreditNoteReasonUpdateInput) {
    const existing = await creditNoteRepository.findReasonById(id);
    if (!existing) throw ApiError.notFound('Credit note reason');
    if (existing.isSystem) {
      const changedFields = Object.keys(data).filter((key) => key !== 'isActive');
      if (changedFields.length > 0) {
        throw ApiError.badRequest('System reasons can only be activated or deactivated');
      }
      return creditNoteRepository.updateReason(id, {
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      });
    }

    if (data.code) {
      const nextCode = data.code.trim().toUpperCase();
      const duplicate = await creditNoteRepository.findReasonByCode(nextCode);
      if (duplicate && duplicate.id !== id) {
        throw ApiError.conflict('A credit note reason with this code already exists');
      }
    }

    return creditNoteRepository.updateReason(id, {
      ...(data.code && { code: data.code.trim().toUpperCase() }),
      ...(data.nameFr && { nameFr: data.nameFr.trim() }),
      ...(data.nameEn && { nameEn: data.nameEn.trim() }),
      ...(data.nameAr && { nameAr: data.nameAr.trim() }),
      ...(data.description !== undefined && { description: data.description?.trim() || null }),
      ...(data.category && { category: data.category.trim().toUpperCase() }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
      ...(data.requiresComment !== undefined && { requiresComment: data.requiresComment }),
      ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
    });
  }

  async getById(id: string, userId: string, scope: PermissionScope) {
    const creditNote = await creditNoteRepository.findById(id, creditNoteAccessWhere(userId, scope));
    if (!creditNote) throw ApiError.notFound('Credit note');
    return this.withSummary(creditNote);
  }

  async update(id: string, userId: string, scope: PermissionScope, data: UpdateCreditNoteInput) {
    const existing = await this.getById(id, userId, scope);
    if (existing.status !== CreditNoteStatus.DRAFT) {
      throw ApiError.badRequest('Only draft credit notes can be edited');
    }

    const invoice = await creditNoteRepository.findInvoiceById(existing.invoiceId, invoiceAccessWhere(userId, scope));
    if (!invoice) throw ApiError.notFound('Invoice');
    const resolvedReason = await this.resolveReasonForWrite(data.reasonId, data.reason);
    const reason = resolvedReason.reason;
    const reasonText = resolvedReason.explanation || reason.nameFr;
    const totals = this.resolveTotals({ ...data, invoiceId: invoice.id, reason: reasonText }, invoice);
    this.assertCreditWithinRemaining(totals.total, this.remainingCreditable(invoice));

    const updated = await creditNoteRepository.updateDraft(id, {
      type: data.type,
      issueDate: new Date(data.issueDate),
      reasonId: reason.id,
      reasonCodeSnapshot: reason.code,
      reasonNameSnapshot: this.reasonSnapshot(reason),
      reason: reasonText,
      internalComment: data.internalComment?.trim() || null,
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      total: totals.total,
      lines: { create: totals.lines },
      auditLogs: {
        create: {
          action: 'UPDATED',
          actorId: userId,
          previousValues: { total: Number(existing.total), reasonId: existing.reasonId },
          newValues: { total: totals.total, reasonId: reason.id, reasonCode: reason.code },
        },
      },
    });

    return this.withSummary(updated);
  }

  async remove(id: string, userId: string, scope: PermissionScope) {
    const existing = await this.getById(id, userId, scope);
    if (existing.status !== CreditNoteStatus.DRAFT) {
      throw ApiError.badRequest('Only draft credit notes can be deleted');
    }
    await creditNoteRepository.deleteDraft(id);
    return { deleted: true };
  }

  async validate(id: string, userId: string, scope: PermissionScope) {
    return prisma.$transaction(async (tx) => {
      const creditNote = await tx.creditNote.findFirst({
        where: { id, AND: [creditNoteAccessWhere(userId, scope)] },
        include: { lines: true, invoice: { include: { creditNotes: true } } },
      });
      if (!creditNote) throw ApiError.notFound('Credit note');
      if (creditNote.status !== CreditNoteStatus.DRAFT) {
        throw ApiError.badRequest('Only draft credit notes can be validated');
      }
      this.assertInvoiceCanBeCredited(creditNote.invoice.status);
      const activeTotal = creditNote.invoice.creditNotes
        .filter((item) => item.id !== id && isActiveCreditStatus(item.status))
        .reduce((sum, item) => sum + Number(item.total), 0);
      const remaining = roundMoney(Number(creditNote.invoice.total) - activeTotal);
      this.assertCreditWithinRemaining(Number(creditNote.total), remaining);

      const updated = await tx.creditNote.update({
        where: { id },
        data: {
          status: CreditNoteStatus.VALIDATED,
          validatedAt: new Date(),
          validatedById: userId,
          auditLogs: {
            create: {
              action: 'VALIDATED',
              actorId: userId,
              newValues: { status: CreditNoteStatus.VALIDATED },
            },
          },
        },
        include: creditNoteRepository.include(),
      });
      return this.withSummary(updated);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async cancel(id: string, userId: string, scope: PermissionScope, data: CancelCreditNoteInput) {
    const existing = await this.getById(id, userId, scope);
    if (existing.status === CreditNoteStatus.CANCELLED) return existing;
    if (Number(existing.refundedAmount) > 0) {
      throw ApiError.badRequest('A refunded credit note cannot be cancelled');
    }
    if (existing.status !== CreditNoteStatus.DRAFT && existing.status !== CreditNoteStatus.VALIDATED) {
      throw ApiError.badRequest('This credit note cannot be cancelled');
    }

    const updated = await prisma.creditNote.update({
      where: { id },
      data: {
        status: CreditNoteStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledById: userId,
        auditLogs: {
          create: {
            action: 'CANCELLED',
            actorId: userId,
            reason: data.reason.trim(),
            previousValues: { status: existing.status },
            newValues: { status: CreditNoteStatus.CANCELLED },
          },
        },
      },
      include: creditNoteRepository.include(),
    });
    return this.withSummary(updated);
  }

  async refund(id: string, userId: string, scope: PermissionScope, data: RefundCreditNoteInput) {
    const existing = await this.getById(id, userId, scope);
    if (!isActiveCreditStatus(existing.status)) {
      throw ApiError.badRequest('Only validated credit notes can be refunded');
    }
    const newRefundedAmount = roundMoney(Number(existing.refundedAmount) + data.amount);
    if (newRefundedAmount > Number(existing.total)) {
      throw ApiError.badRequest('Refunded amount cannot exceed credit note total');
    }
    const fullyRefunded = newRefundedAmount >= Number(existing.total);

    const updated = await prisma.creditNote.update({
      where: { id },
      data: {
        status: fullyRefunded ? CreditNoteStatus.REFUNDED : CreditNoteStatus.VALIDATED,
        refundedAmount: newRefundedAmount,
        refundStatus: fullyRefunded ? CreditNoteRefundStatus.REFUNDED : CreditNoteRefundStatus.PARTIALLY_REFUNDED,
        refundedAt: new Date(data.refundDate),
        refundedById: userId,
        auditLogs: {
          create: {
            action: 'REFUNDED',
            actorId: userId,
            reason: data.comment?.trim() || data.reference?.trim() || null,
            previousValues: { refundedAmount: Number(existing.refundedAmount) },
            newValues: { refundedAmount: newRefundedAmount },
          },
        },
      },
      include: creditNoteRepository.include(),
    });
    return this.withSummary(updated);
  }

  async pdfBuffer(id: string, userId: string, scope: PermissionScope, language = 'fr') {
    const creditNote = await this.getById(id, userId, scope);
    const company = await settingsService.getCompanySettings();
    await prisma.creditNoteAuditLog.create({
      data: { creditNoteId: id, actorId: userId, action: 'PDF_DOWNLOADED' },
    });
    return {
      fileName: `${safeFileName(creditNote.creditNoteNumber)}.pdf`,
      buffer: await renderCreditNotePdfBuffer(creditNote, company, language),
    };
  }

  async sendEmail(id: string, userId: string, scope: PermissionScope, data: SendCreditNoteEmailInput) {
    const creditNote = await this.getById(id, userId, scope);
    if (creditNote.status === CreditNoteStatus.CANCELLED) {
      throw ApiError.badRequest('Cannot email a cancelled credit note');
    }
    const company = await settingsService.getCompanySettings();
    const recipientEmail = data.recipientEmail ?? creditNote.customer.email;
    const subject = data.subject ?? `Avoir ${creditNote.creditNoteNumber}`;
    const text = data.message ?? [
      `Bonjour ${creditNote.customer.name},`,
      '',
      `Veuillez trouver ci-joint l'avoir ${creditNote.creditNoteNumber} lie a la facture ${creditNote.invoice.invoiceNumber}.`,
      `Montant total: ${formatCurrency(Number(creditNote.total), creditNote.currency)}.`,
      '',
      'Cordialement,',
      company.name,
    ].join('\n');
    const pdf = await renderCreditNotePdfBuffer(creditNote, company, data.pdfLanguage ?? 'fr');
    const attachmentName = `${safeFileName(creditNote.creditNoteNumber)}.pdf`;

    try {
      const delivery = await sendEmail({
        to: recipientEmail,
        subject,
        text,
        attachments: [{ filename: attachmentName, content: pdf, contentType: 'application/pdf' }],
      });
      await creditNoteRepository.createEmailLog({
        creditNoteId: id,
        sentById: userId,
        recipientEmail,
        subject,
        message: text,
        pdfLanguage: data.pdfLanguage ?? 'fr',
        attachmentName,
        status: 'SENT',
        deliveryMode: delivery.mode,
        messageId: delivery.messageId,
        filePath: delivery.filePath,
      });
      await prisma.creditNoteAuditLog.create({
        data: { creditNoteId: id, actorId: userId, action: 'EMAIL_SENT', newValues: { recipientEmail } },
      });
      return { email: { to: recipientEmail, subject } };
    } catch (error) {
      await creditNoteRepository.createEmailLog({
        creditNoteId: id,
        sentById: userId,
        recipientEmail,
        subject,
        message: text,
        pdfLanguage: data.pdfLanguage ?? 'fr',
        attachmentName,
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : 'Unknown email error',
      });
      await prisma.creditNoteAuditLog.create({
        data: { creditNoteId: id, actorId: userId, action: 'EMAIL_FAILED', newValues: { recipientEmail } },
      });
      throw error;
    }
  }

  private buildWhere(userId: string, scope: PermissionScope, query: CreditNoteQueryInput): Prisma.CreditNoteWhereInput {
    const where: Prisma.CreditNoteWhereInput = { AND: [creditNoteAccessWhere(userId, scope)] };
    if (query.status) where.status = query.status;
    if (query.invoiceId) where.invoiceId = query.invoiceId;
    if (query.customerId) where.customerId = query.customerId;
    if (query.dateFrom || query.dateTo) {
      where.issueDate = {
        ...(query.dateFrom && { gte: new Date(query.dateFrom) }),
        ...(query.dateTo && { lte: new Date(query.dateTo) }),
      };
    }
    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        { creditNoteNumber: { contains: search, mode: 'insensitive' } },
        { reason: { contains: search, mode: 'insensitive' } },
        { invoice: { invoiceNumber: { contains: search, mode: 'insensitive' } } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { customer: { company: { contains: search, mode: 'insensitive' } } },
      ];
    }
    return where;
  }

  private resolveTotals(data: CreditNoteCalculationInput, invoice: Awaited<ReturnType<typeof creditNoteRepository.findInvoiceById>>) {
    if (!invoice) throw ApiError.notFound('Invoice');
    if (data.type === CreditNoteType.FULL) {
      const remaining = this.remainingCreditable(invoice);
      if (remaining <= 0) throw ApiError.badRequest('Invoice has no remaining creditable amount');
      const taxRate = Number(invoice.taxRate);
      const subtotal = roundMoney(remaining / (1 + taxRate / 100));
      const taxAmount = roundMoney(remaining - subtotal);
      return {
        subtotal,
        taxAmount,
        total: remaining,
        lines: [{
          description: `Full credit for invoice ${invoice.invoiceNumber}`,
          unit: null,
          quantity: 1,
          unitPrice: subtotal,
          taxRate,
          lineTotal: remaining,
          sortOrder: 1,
        }],
      };
    }

    const lines: CreditNoteCalculationLine[] = data.amountTTC
      ? [{
          description: data.reason,
          unit: null,
          quantity: 1,
          unitPrice: roundMoney(data.amountTTC / (1 + Number(invoice.taxRate) / 100)),
          taxRate: Number(invoice.taxRate),
        }]
      : data.lines ?? [];

    const normalized = lines.map((line: CreditNoteCalculationLine, index: number) => {
      if (line.invoiceItemId) {
        const item = invoice.items.find((entry) => entry.id === line.invoiceItemId);
        if (!item) throw ApiError.badRequest('Credit note line is not linked to this invoice');
        const creditedQuantity = invoice.creditNotes.flatMap((note) => note.lines)
          .filter((creditLine) => creditLine.invoiceItemId === line.invoiceItemId)
          .reduce((sum, creditLine) => sum + Number(creditLine.quantity), 0);
        if (line.quantity > Number(item.quantity) - creditedQuantity) {
          throw ApiError.badRequest('Credit note quantity exceeds remaining invoice item quantity');
        }
      }
      const taxRate = line.taxRate ?? Number(invoice.taxRate);
      const subtotal = roundMoney(line.quantity * line.unitPrice);
      const lineTotal = roundMoney(subtotal + subtotal * (taxRate / 100));
      return {
        invoiceItemId: line.invoiceItemId ?? null,
        description: line.description.trim(),
        unit: line.unit?.trim() || null,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        taxRate,
        lineTotal,
        sortOrder: index + 1,
      };
    });
    const subtotal = roundMoney(normalized.reduce((sum: number, line) => sum + line.quantity * line.unitPrice, 0));
    const taxAmount = roundMoney(normalized.reduce((sum: number, line) => sum + (line.quantity * line.unitPrice * (line.taxRate / 100)), 0));
    const total = roundMoney(normalized.reduce((sum: number, line) => sum + line.lineTotal, 0));
    if (total <= 0) throw ApiError.badRequest('Credit note total must be positive');
    return { subtotal, taxAmount, total, lines: normalized };
  }

  private remainingCreditable(invoice: NonNullable<Awaited<ReturnType<typeof creditNoteRepository.findInvoiceById>>>) {
    const credited = invoice.creditNotes
      .filter((creditNote) => isActiveCreditStatus(creditNote.status))
      .reduce((sum, creditNote) => sum + Number(creditNote.total), 0);
    return roundMoney(Number(invoice.total) - credited);
  }

  private assertCreditWithinRemaining(total: number, remaining: number) {
    if (total > remaining) {
      throw ApiError.conflict('Credit note total cannot exceed the remaining creditable invoice amount');
    }
  }

  private assertInvoiceCanBeCredited(status: InvoiceStatus) {
    if (status === InvoiceStatus.DRAFT || status === InvoiceStatus.CANCELLED) {
      throw ApiError.badRequest('Draft or cancelled invoices cannot receive credit notes');
    }
  }

  private async resolveReasonForWrite(reasonId: string, explanation?: string | null) {
    const reason = await creditNoteRepository.findReasonById(reasonId);
    if (!reason) throw ApiError.badRequest('Credit note reason is invalid');
    if (!reason.isActive) throw ApiError.badRequest('Inactive credit note reasons cannot be selected');
    const normalizedExplanation = explanation?.trim() ?? '';
    if ((reason.code === 'OTHER' || reason.requiresComment) && normalizedExplanation.length === 0) {
      throw ApiError.badRequest('This credit note reason requires a detailed explanation');
    }
    return { reason, explanation: normalizedExplanation };
  }

  private reasonSnapshot(reason: { code: string; nameFr: string; nameEn: string; nameAr: string }) {
    return {
      fr: reason.nameFr,
      en: reason.nameEn,
      ar: reason.nameAr,
    };
  }

  private withSummary<T extends { invoice: { total: unknown; amountPaid: unknown; balanceDue: unknown }; total: unknown; refundedAmount: unknown }>(creditNote: T) {
    const originalTotal = Number(creditNote.invoice.total);
    const creditTotal = Number(creditNote.total);
    const paidAmount = Number(creditNote.invoice.amountPaid);
    return {
      ...creditNote,
      invoiceCreditSummary: {
        originalTotal,
        creditTotal,
        netTotal: roundMoney(originalTotal - creditTotal),
        paidAmount,
        remainingBalance: Math.max(0, roundMoney(Number(creditNote.invoice.balanceDue) - creditTotal)),
        refundableAmount: Math.max(0, roundMoney(Math.min(paidAmount, creditTotal) - Number(creditNote.refundedAmount))),
      },
    };
  }
}

type CreditNoteCalculationLine = {
  invoiceItemId?: string | null;
  description: string;
  unit?: string | null;
  quantity: number;
  unitPrice: number;
  taxRate?: number;
};

type CreditNoteCalculationInput = {
  invoiceId: string;
  type: CreditNoteType;
  issueDate: string;
  reason: string;
  internalComment?: string | null;
  lines?: CreditNoteCalculationLine[];
  amountTTC?: number;
};

function isActiveCreditStatus(status: CreditNoteStatus) {
  return status === CreditNoteStatus.VALIDATED || status === CreditNoteStatus.REFUNDED;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat('fr-MA', { style: 'currency', currency }).format(amount);
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export const creditNoteService = new CreditNoteService();
