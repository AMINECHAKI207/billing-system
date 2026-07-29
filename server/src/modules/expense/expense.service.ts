import { ExpenseAIStatus, ExpenseNoteStatus, ExpenseSource, PermissionScope, Prisma } from '@prisma/client';
import fs from 'fs/promises';
import { prisma } from '@config/database';
import { env } from '@config/env';
import { ApiError } from '@utils/ApiError';
import { parsePagination } from '@utils/pagination';
import { expenseNoteAccessWhere, permissionScope } from '@modules/rbac/accessScope';
import { settingsService } from '@modules/settings/settings.service';
import { sendEmail } from '@services/email.service';
import { renderExpensePdfBuffer, renderExpenseReportPdfBuffer } from './expense.pdf';
import { renderExpenseNotesCsv, renderExpenseNotesExcelBuffer } from './expense.excel';
import { resolveReceiptStorageKey, saveReceipt } from './expense.upload';
import { analyzeReceiptWithOpenAI } from './expense.ai';
import { ZipArchive } from 'archiver';
import {
  CategoryQueryInput,
  CreateExpenseCategoryInput,
  CreateExpenseNoteInput,
  CreateExpenseTypeInput,
  ExpenseNoteQueryInput,
  ExpenseBulkExportInput,
  SendExpenseEmailInput,
  TypeQueryInput,
  UpdateExpenseCategoryInput,
  UpdateExpenseNoteInput,
  UpdateExpenseTypeInput,
} from './expense.schema';
import { expenseNoteInclude, expenseRepository } from './expense.repository';

interface AuthUser {
  id: string;
  permissionScopes?: Record<string, PermissionScope>;
}

type AuditAction =
  | 'CREATED'
  | 'UPDATED'
  | 'RECEIPT_UPLOADED'
  | 'AI_ANALYSIS_COMPLETED'
  | 'AI_ANALYSIS_FAILED'
  | 'SUBMITTED'
  | 'RESUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'CHANGES_REQUESTED'
  | 'PAID'
  | 'DELETED'
  | 'PDF_PREVIEWED'
  | 'PDF_DOWNLOADED'
  | 'PDF_PRINTED'
  | 'EMAIL_SENT'
  | 'EMAIL_FAILED'
  | 'EMAIL_RESENT'
  | 'BULK_EXPORT_GENERATED'
  | 'EXPENSE_REPORT_EXPORTED';

const EMPLOYEE_EDITABLE_STATUSES = new Set<ExpenseNoteStatus>([
  ExpenseNoteStatus.DRAFT,
]);

const ADMIN_EDITABLE_STATUSES = new Set<ExpenseNoteStatus>([
  ExpenseNoteStatus.DRAFT,
  ExpenseNoteStatus.NEEDS_REVIEW,
  ExpenseNoteStatus.SUBMITTED,
  ExpenseNoteStatus.CHANGES_REQUESTED,
  ExpenseNoteStatus.APPROVED,
  ExpenseNoteStatus.REJECTED,
]);

export class ExpenseService {
  async listCategories(query: CategoryQueryInput) {
    return expenseRepository.findCategories({
      ...(query.active !== undefined && { active: query.active }),
    });
  }

  async createCategory(data: CreateExpenseCategoryInput) {
    return expenseRepository.createCategory(data);
  }

  async updateCategory(id: string, data: UpdateExpenseCategoryInput) {
    await this.ensureCategoryExists(id);
    return expenseRepository.updateCategory(id, data);
  }

  async listTypes(query: TypeQueryInput) {
    return expenseRepository.findTypes({
      ...(query.categoryId && { categoryId: query.categoryId }),
      ...(query.active !== undefined && { active: query.active }),
    });
  }

  async createType(data: CreateExpenseTypeInput) {
    await this.ensureCategoryExists(data.categoryId);
    return expenseRepository.createType({
      name: data.name,
      active: data.active,
      category: { connect: { id: data.categoryId } },
    });
  }

  async updateType(id: string, data: UpdateExpenseTypeInput) {
    await this.ensureTypeExists(id);
    if (data.categoryId) await this.ensureCategoryExists(data.categoryId);

    return expenseRepository.updateType(id, {
      name: data.name,
      active: data.active,
      ...(data.categoryId && { category: { connect: { id: data.categoryId } } }),
    });
  }

  async listNotes(user: AuthUser, query: ExpenseNoteQueryInput) {
    const { skip, limit, page } = parsePagination({ page: query.page, limit: query.limit });
    const scope = permissionScope(user.permissionScopes, 'expense_notes.view');
    const where = this.buildExpenseWhere(user.id, scope, query);

    const { data, total } = await expenseRepository.findNotes({ skip, take: limit, where });
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

  async getAnalytics(user: AuthUser, query: ExpenseNoteQueryInput) {
    const scope = permissionScope(user.permissionScopes, 'expense_notes.view');
    const where = this.buildExpenseWhere(user.id, scope, query);
    const notes = await prisma.expenseNote.findMany({
      where,
      include: {
        category: true,
        expenseType: true,
        createdBy: { select: { id: true, name: true, email: true } },
        attachments: { select: { id: true } },
      },
      orderBy: { expenseDate: 'desc' },
    });

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const totalAmount = notes.reduce((sum, note) => sum + Number(note.amountTTC), 0);
    const approvalDurations = notes
      .filter((note) => note.submittedAt && note.approvedAt)
      .map((note) => new Date(note.approvedAt!).getTime() - new Date(note.submittedAt!).getTime());

    return {
      totals: {
        count: notes.length,
        amountTTC: totalAmount,
        amountHT: notes.reduce((sum, note) => sum + Number(note.amountHT ?? 0), 0),
        vatAmount: notes.reduce((sum, note) => sum + Number(note.vatAmount), 0),
        averageExpense: notes.length ? totalAmount / notes.length : 0,
        averageApprovalHours: approvalDurations.length
          ? approvalDurations.reduce((sum, duration) => sum + duration, 0) / approvalDurations.length / 36e5
          : 0,
        currentMonth: this.sumFromDate(notes, monthStart),
        currentQuarter: this.sumFromDate(notes, quarterStart),
        currentYear: this.sumFromDate(notes, yearStart),
      },
      byMonth: this.groupNotes(notes, (note) => new Date(note.expenseDate).toISOString().slice(0, 7)),
      byCategory: this.groupNotes(notes, (note) => note.category?.name ?? 'Uncategorized'),
      byEmployee: this.groupNotes(notes, (note) => note.createdBy?.name ?? 'Unknown'),
      byStatus: this.groupNotes(notes, (note) => note.status),
      byCurrency: this.groupNotes(notes, (note) => note.currency),
      topMerchants: this.groupNotes(notes, (note) => note.merchantName || 'Unknown')
        .sort((a, b) => b.amountTTC - a.amountTTC)
        .slice(0, 8),
    };
  }

  async getNote(user: AuthUser, id: string) {
    const scope = permissionScope(user.permissionScopes, 'expense_notes.view');
    const note = await expenseRepository.findNoteById(id, expenseNoteAccessWhere(user.id, scope));
    if (!note) throw ApiError.notFound('Expense note');
    return note;
  }

  async renderNotePdf(user: AuthUser & { name?: string; email?: string }, id: string, permission: string, action: AuditAction, language: 'en' | 'fr' | 'ar') {
    const scope = permissionScope(user.permissionScopes, permission);
    const note = await expenseRepository.findNoteById(id, expenseNoteAccessWhere(user.id, scope));
    if (!note) throw ApiError.notFound('Expense note');
    const company = await settingsService.getCompanySettings();
    const buffer = await renderExpensePdfBuffer(note, company, {
      name: user.name ?? note.createdBy?.name ?? 'User',
      email: user.email ?? note.createdBy?.email ?? '',
    }, language);
    await expenseRepository.createAuditLog({
      expenseNote: { connect: { id: note.id } },
      actor: { connect: { id: user.id } },
      action,
      newValues: { language, fileName: this.pdfFileName(note) },
    });
    return {
      buffer,
      fileName: this.pdfFileName(note),
      note,
    };
  }

  async sendNoteEmail(user: AuthUser, id: string, data: SendExpenseEmailInput, options: { allowDuplicate?: boolean } = {}) {
    const scope = permissionScope(user.permissionScopes, 'expense_notes.email.send');
    const note = await expenseRepository.findNoteById(id, expenseNoteAccessWhere(user.id, scope));
    if (!note) throw ApiError.notFound('Expense note');

    const to = data.to ?? note.createdBy?.email;
    if (!to) throw ApiError.badRequest('Recipient email is required.');

    if (!options.allowDuplicate) {
      const duplicateSince = new Date(Date.now() - 2 * 60 * 1000);
      const duplicate = await prisma.expenseEmailLog.findFirst({
        where: {
          expenseNoteId: note.id,
          recipientEmail: to,
          status: 'SENT',
          createdAt: { gte: duplicateSince },
        },
      });
      if (duplicate) throw ApiError.conflict('This expense note was already emailed recently.');
    }

    const company = await settingsService.getCompanySettings();
    const fileName = this.pdfFileName(note);
    const subject = cleanEmailSubject(data.subject ?? `Note de frais ${this.expenseReference(note)}`);
    const message = cleanEmailText(data.message ?? defaultExpenseEmailMessage(note));
    const pdf = await renderExpensePdfBuffer(note, company, note.createdBy ?? { name: 'User', email: '' }, data.pdfLanguage);

    try {
      const delivery = await sendEmail({
        to,
        cc: data.cc,
        bcc: data.bcc,
        subject,
        text: message,
        attachments: [{ filename: fileName, content: pdf, contentType: 'application/pdf' }],
      });
      const emailLog = await expenseRepository.createEmailLog({
        expenseNoteId: note.id,
        sentById: user.id,
        recipientEmail: to,
        cc: data.cc.join(','),
        bcc: data.bcc.join(','),
        subject,
        message,
        pdfLanguage: data.pdfLanguage,
        attachmentName: fileName,
        status: 'SENT',
        deliveryMode: delivery.mode,
        messageId: delivery.messageId,
        filePath: delivery.filePath,
      });
      await expenseRepository.createAuditLog({
        expenseNote: { connect: { id: note.id } },
        actor: { connect: { id: user.id } },
        action: 'EMAIL_SENT',
        newValues: { recipientEmail: to, subject, deliveryMode: delivery.mode },
      });
      return { expenseNote: note, emailLog: redactEmailLog(emailLog), delivery: delivery.filePath ? { ...delivery, filePath: undefined } : delivery };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown email error';
      const emailLog = await expenseRepository.createEmailLog({
        expenseNoteId: note.id,
        sentById: user.id,
        recipientEmail: to,
        cc: data.cc.join(','),
        bcc: data.bcc.join(','),
        subject,
        message,
        pdfLanguage: data.pdfLanguage,
        attachmentName: fileName,
        status: 'FAILED',
        errorMessage,
      });
      await expenseRepository.createAuditLog({
        expenseNote: { connect: { id: note.id } },
        actor: { connect: { id: user.id } },
        action: 'EMAIL_FAILED',
        newValues: { recipientEmail: to, subject, errorMessage },
      });
      return { expenseNote: note, emailLog: redactEmailLog(emailLog), delivery: null };
    }
  }

  async getEmailHistory(user: AuthUser, id: string) {
    const scope = permissionScope(user.permissionScopes, 'expense_notes.email.history');
    const note = await expenseRepository.findNoteById(id, expenseNoteAccessWhere(user.id, scope));
    if (!note) throw ApiError.notFound('Expense note');
    const logs = await expenseRepository.findEmailLogs(note.id);
    return logs.map(redactEmailLog);
  }

  async resendEmail(user: AuthUser, emailLogId: string) {
    const scope = permissionScope(user.permissionScopes, 'expense_notes.email.resend');
    const emailLog = await expenseRepository.findEmailLogById(emailLogId);
    if (!emailLog) throw ApiError.notFound('Expense email log');
    const note = await expenseRepository.findNoteById(emailLog.expenseNoteId, expenseNoteAccessWhere(user.id, scope));
    if (!note) throw ApiError.notFound('Expense note');
    const result = await this.sendNoteEmail(user, note.id, {
      to: emailLog.recipientEmail,
      cc: splitEmails(emailLog.cc),
      bcc: splitEmails(emailLog.bcc),
      subject: emailLog.subject,
      message: emailLog.message,
      pdfLanguage: normalizeLanguage(emailLog.pdfLanguage),
    }, { allowDuplicate: true });
    await expenseRepository.createAuditLog({
      expenseNote: { connect: { id: note.id } },
      actor: { connect: { id: user.id } },
      action: 'EMAIL_RESENT',
      newValues: { originalEmailLogId: emailLog.id, newStatus: result.emailLog.status },
    });
    return result;
  }

  async exportNotes(user: AuthUser & { name?: string; email?: string }, data: ExpenseBulkExportInput) {
    const permission = data.format === 'excel' ? 'expense_notes.export.excel' : data.format === 'csv' ? 'expense_notes.report.export' : 'expense_notes.pdf.bulk_export';
    const scope = permissionScope(user.permissionScopes, permission);
    const notes = await this.findNotesForExport(user.id, scope, data.ids, data.filters);
    if (data.ids?.length && notes.length !== new Set(data.ids).size) {
      throw ApiError.forbidden('One or more selected expense notes are not authorized.');
    }
    if (!notes.length) throw ApiError.badRequest('No expense notes selected for export.');

    const generatedAt = new Date().toISOString().slice(0, 10);
    if (data.format === 'excel') {
      const buffer = await renderExpenseNotesExcelBuffer(notes, 'Expense Notes Report');
      await this.auditBulkExport(user.id, notes, 'EXPENSE_REPORT_EXPORTED', { format: data.format, count: notes.length });
      return {
        buffer,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileName: `expense-notes-${generatedAt}.xlsx`,
      };
    }
    if (data.format === 'csv') {
      const csv = renderExpenseNotesCsv(notes);
      await this.auditBulkExport(user.id, notes, 'EXPENSE_REPORT_EXPORTED', { format: data.format, count: notes.length });
      return {
        buffer: Buffer.from(csv, 'utf8'),
        contentType: 'text/csv; charset=utf-8',
        fileName: `expense-notes-${generatedAt}.csv`,
      };
    }
    if (data.format === 'zip') {
      const company = await settingsService.getCompanySettings();
      const files = await Promise.all(notes.map(async (note) => ({
        name: this.pdfFileName(note),
        buffer: await renderExpensePdfBuffer(note, company, { name: user.name ?? 'User', email: user.email ?? '' }, data.language),
      })));
      const buffer = await createZipBuffer(files);
      await this.auditBulkExport(user.id, notes, 'BULK_EXPORT_GENERATED', { format: data.format, count: notes.length });
      return {
        buffer,
        contentType: 'application/zip',
        fileName: `expense-notes-${generatedAt}.zip`,
      };
    }

    const company = await settingsService.getCompanySettings();
    const reportPdf = await renderExpenseReportPdfBuffer(notes, company, { name: user.name ?? 'User', email: user.email ?? '' }, data.language);
    await this.auditBulkExport(user.id, notes, 'BULK_EXPORT_GENERATED', { format: data.format, count: notes.length });
    return {
      buffer: reportPdf,
      contentType: 'application/pdf',
      fileName: `expense-notes-report-${generatedAt}.pdf`,
    };
  }

  async createNote(user: AuthUser, data: CreateExpenseNoteInput) {
    await this.validateCategoryType(data.categoryId, data.expenseTypeId);
    await this.validateAttachmentOwnership(user.id, data.attachmentId);
    await this.validateAIAnalysisOwnership(user.id, data.aiAnalysisId, data.attachmentId);
    const status = data.submit ? ExpenseNoteStatus.SUBMITTED : ExpenseNoteStatus.DRAFT;
    const now = new Date();

    const note = await prisma.$transaction(async (tx) => {
      const created = await tx.expenseNote.create({
        data: {
          categoryId: data.categoryId,
          expenseTypeId: data.expenseTypeId,
          createdById: user.id,
          status,
          submittedAt: data.submit ? now : null,
          expenseDate: data.expenseDate,
          amountTTC: data.amountTTC,
          amountHT: data.amountHT,
          vatAmount: data.vatAmount,
          vatRate: data.vatRate,
          comment: data.comment,
          merchantName: data.merchantName,
          receiptNumber: data.receiptNumber,
          documentNumber: data.receiptNumber,
          currency: data.currency,
          source: data.source,
          aiConfidence: data.aiAnalysisId ? await this.averageConfidence(data.aiAnalysisId) : undefined,
        },
        include: expenseNoteInclude,
      });

      if (data.attachmentId) {
        await tx.expenseAttachment.update({ where: { id: data.attachmentId }, data: { expenseNoteId: created.id } });
      }
      if (data.aiAnalysisId) {
        await tx.expenseAIAnalysis.update({ where: { id: data.aiAnalysisId }, data: { expenseNoteId: created.id } });
      }

      await this.audit(tx, created.id, user.id, 'CREATED', null, snapshot(created));
      if (data.attachmentId) await this.audit(tx, created.id, user.id, 'RECEIPT_UPLOADED', null, { attachmentId: data.attachmentId });
      if (data.submit) await this.audit(tx, created.id, user.id, 'SUBMITTED', null, { status });

      return tx.expenseNote.findUniqueOrThrow({ where: { id: created.id }, include: expenseNoteInclude });
    });

    return note;
  }

  async updateNote(user: AuthUser, id: string, data: UpdateExpenseNoteInput) {
    const scope = permissionScope(user.permissionScopes, 'expense_notes.update');
    const existing = await expenseRepository.findNoteById(id, expenseNoteAccessWhere(user.id, scope));
    if (!existing) throw ApiError.notFound('Expense note');
    this.ensureCanEdit(existing.status, scope);

    const categoryId = data.categoryId ?? existing.categoryId;
    const expenseTypeId = data.expenseTypeId ?? existing.expenseTypeId;
    await this.validateCategoryType(categoryId, expenseTypeId);

    return prisma.$transaction(async (tx) => {
      const updated = await tx.expenseNote.update({
        where: { id },
        data: {
          ...(data.categoryId && { categoryId: data.categoryId }),
          ...(data.expenseTypeId && { expenseTypeId: data.expenseTypeId }),
          expenseDate: data.expenseDate,
          amountTTC: data.amountTTC,
          amountHT: data.amountHT,
          vatAmount: data.vatAmount,
          vatRate: data.vatRate,
          comment: data.comment,
          merchantName: data.merchantName,
          receiptNumber: data.receiptNumber,
          documentNumber: data.receiptNumber,
          currency: data.currency,
          source: data.source,
        },
        include: expenseNoteInclude,
      });
      await this.audit(tx, id, user.id, 'UPDATED', snapshot(existing), snapshot(updated));
      return updated;
    });
  }

  async deleteNote(user: AuthUser, id: string) {
    const scope = permissionScope(user.permissionScopes, 'expense_notes.delete');
    const existing = await expenseRepository.findNoteById(id, expenseNoteAccessWhere(user.id, scope));
    if (!existing) throw ApiError.notFound('Expense note');
    if (!EMPLOYEE_EDITABLE_STATUSES.has(existing.status) && scope !== PermissionScope.ALL) {
      throw ApiError.badRequest('Only draft expense notes can be deleted.');
    }
    await prisma.$transaction(async (tx) => {
      await this.audit(tx, id, user.id, 'DELETED', snapshot(existing), null);
      await tx.expenseNote.delete({ where: { id } });
    });
  }

  async submitNote(user: AuthUser, id: string) {
    const scope = permissionScope(user.permissionScopes, 'expense_notes.submit');
    const existing = await expenseRepository.findNoteById(id, expenseNoteAccessWhere(user.id, scope));
    if (!existing) throw ApiError.notFound('Expense note');
    this.ensureTransition(existing.status, [ExpenseNoteStatus.DRAFT, ExpenseNoteStatus.NEEDS_REVIEW, ExpenseNoteStatus.CHANGES_REQUESTED]);
    await this.validateCategoryType(existing.categoryId, existing.expenseTypeId);

    const action: AuditAction = existing.status === ExpenseNoteStatus.CHANGES_REQUESTED ? 'RESUBMITTED' : 'SUBMITTED';
    return this.transition(user.id, existing, ExpenseNoteStatus.SUBMITTED, action, {
      submittedAt: new Date(),
      changesRequestedById: null,
      changesRequestedAt: null,
      changesRequestedReason: null,
    });
  }

  async approveNote(user: AuthUser, id: string) {
    const existing = await this.getActionableNote(user, id, 'expense_notes.approve');
    this.ensureTransition(existing.status, [ExpenseNoteStatus.SUBMITTED]);
    return this.transition(user.id, existing, ExpenseNoteStatus.APPROVED, 'APPROVED', {
      approvedById: user.id,
      approvedAt: new Date(),
    });
  }

  async rejectNote(user: AuthUser, id: string, reason: string) {
    const existing = await this.getActionableNote(user, id, 'expense_notes.reject');
    this.ensureTransition(existing.status, [ExpenseNoteStatus.SUBMITTED]);
    return this.transition(user.id, existing, ExpenseNoteStatus.REJECTED, 'REJECTED', {
      rejectedById: user.id,
      rejectedAt: new Date(),
      rejectionReason: reason,
    }, reason);
  }

  async requestChanges(user: AuthUser, id: string, reason: string) {
    const existing = await this.getActionableNote(user, id, 'expense_notes.request_changes');
    this.ensureTransition(existing.status, [ExpenseNoteStatus.SUBMITTED]);
    return this.transition(user.id, existing, ExpenseNoteStatus.CHANGES_REQUESTED, 'CHANGES_REQUESTED', {
      changesRequestedById: user.id,
      changesRequestedAt: new Date(),
      changesRequestedReason: reason,
    }, reason);
  }

  async markPaid(user: AuthUser, id: string) {
    const existing = await this.getActionableNote(user, id, 'expense_notes.mark_paid');
    this.ensureTransition(existing.status, [ExpenseNoteStatus.APPROVED]);
    return this.transition(user.id, existing, ExpenseNoteStatus.PAID, 'PAID', {
      paidById: user.id,
      paidAt: new Date(),
    });
  }

  async getAttachmentForDownload(user: AuthUser, attachmentId: string) {
    const scope = permissionScope(user.permissionScopes, 'expense_attachments.view');
    const attachment = await expenseRepository.findAttachmentById(attachmentId);
    if (!attachment) throw ApiError.notFound('Expense attachment');
    if (!attachment.expenseNoteId) {
      if (scope !== PermissionScope.ALL && attachment.uploadedById !== user.id) throw ApiError.forbidden('Forbidden');
      return { attachment, filePath: resolveReceiptStorageKey(attachment.storageKey) };
    }

    const note = await expenseRepository.findNoteById(attachment.expenseNoteId, expenseNoteAccessWhere(user.id, scope));
    if (!note) throw ApiError.forbidden('Forbidden');
    return { attachment, filePath: resolveReceiptStorageKey(attachment.storageKey) };
  }

  async deleteAttachment(user: AuthUser, attachmentId: string) {
    const scope = permissionScope(user.permissionScopes, 'expense_notes.update');
    const attachment = await expenseRepository.findAttachmentById(attachmentId);
    if (!attachment) throw ApiError.notFound('Expense attachment');

    if (!attachment.expenseNoteId) {
      if (scope !== PermissionScope.ALL && attachment.uploadedById !== user.id) throw ApiError.forbidden('Forbidden');
      await expenseRepository.deleteAttachment(attachment.id);
      await this.removeStoredReceipt(attachment.storageKey);
      return;
    }

    const note = await expenseRepository.findNoteById(attachment.expenseNoteId, expenseNoteAccessWhere(user.id, scope));
    if (!note) throw ApiError.forbidden('Forbidden');
    if (note.status !== ExpenseNoteStatus.DRAFT) {
      throw ApiError.badRequest('Receipt can only be removed while the expense note is draft.');
    }

    await prisma.$transaction(async (tx) => {
      await this.audit(tx, note.id, user.id, 'UPDATED', snapshot(note), { attachmentRemoved: attachment.id });
      await tx.expenseAttachment.delete({ where: { id: attachment.id } });
    });
    await this.removeStoredReceipt(attachment.storageKey);
  }

  async analyzeReceipt(user: AuthUser, file?: Express.Multer.File) {
    if (!file) throw ApiError.badRequest('Receipt file is required.');

    const saved = await saveReceipt(file);
    const attachment = await expenseRepository.createAttachment({
      originalName: file.originalname,
      fileName: saved.fileName,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      storageKey: saved.storageKey,
      fileUrl: saved.fileUrl,
      uploadedBy: { connect: { id: user.id } },
    });

    const categories = (await expenseRepository.findCategories({ active: true }))
      .map((category) => ({
        id: category.id,
        name: category.name,
        expenseTypes: category.expenseTypes
          .filter((type) => type.active)
          .map((type) => ({ id: type.id, name: type.name })),
      }))
      .filter((category) => category.expenseTypes.length > 0);

    if (!categories.length) {
      throw ApiError.badRequest('No active expense categories and types are configured.');
    }

    const startedAt = Date.now();
    try {
      const result = await analyzeReceiptWithOpenAI({
        filePath: resolveReceiptStorageKey(attachment.storageKey),
        mimeType: attachment.mimeType,
        categories,
      });
      const completedAt = new Date();
      const analysis = await expenseRepository.createAIAnalysis({
        attachment: { connect: { id: attachment.id } },
        requestedBy: { connect: { id: user.id } },
        provider: 'openai',
        model: env.OPENAI_MODEL,
        status: result.requiresManualReview ? ExpenseAIStatus.REQUIRES_MANUAL_REVIEW : ExpenseAIStatus.VALIDATED,
        attempts: result.attempts,
        rawResponse: result.rawResponse as Prisma.InputJsonValue,
        extractedData: (result.data ?? {}) as Prisma.InputJsonValue,
        validationErrors: result.validationErrors as Prisma.InputJsonValue,
        confidence: (result.data?.confidence ?? {}) as Prisma.InputJsonValue,
        warnings: (result.data?.warnings ?? result.validationErrors) as Prisma.InputJsonValue,
        requiresManualReview: result.requiresManualReview,
        processingDurationMs: Date.now() - startedAt,
        completedAt,
      });

      return this.buildAnalysisResponse(attachment, analysis, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OpenAI receipt analysis failed.';
      const analysis = await expenseRepository.createAIAnalysis({
        attachment: { connect: { id: attachment.id } },
        requestedBy: { connect: { id: user.id } },
        provider: 'openai',
        model: env.OPENAI_MODEL,
        status: ExpenseAIStatus.FAILED,
        attempts: 1,
        rawResponse: {},
        extractedData: {},
        validationErrors: [message],
        confidence: {},
        warnings: [message],
        requiresManualReview: true,
        processingDurationMs: Date.now() - startedAt,
        completedAt: new Date(),
      });

      return {
        attachment,
        analysis,
        suggestedExpense: {
          attachmentId: attachment.id,
          aiAnalysisId: analysis.id,
          source: ExpenseSource.AI,
          warnings: [message],
          requiresManualReview: true,
        },
      };
    }
  }

  private buildAnalysisResponse(
    attachment: Awaited<ReturnType<typeof expenseRepository.createAttachment>>,
    analysis: Awaited<ReturnType<typeof expenseRepository.createAIAnalysis>>,
    result: Awaited<ReturnType<typeof analyzeReceiptWithOpenAI>>
  ) {
    return {
      attachment,
      analysis,
      suggestedExpense: result.data
        ? {
          categoryId: result.data.categoryId,
          expenseTypeId: result.data.expenseTypeId,
          expenseDate: result.data.expenseDate,
          amountTTC: result.data.amountTTC,
          amountHT: result.data.amountHT,
          vatAmount: result.data.vatAmount,
          vatRate: result.data.vatRate,
          merchantName: result.data.merchantName,
          receiptNumber: result.data.documentNumber,
          documentNumber: result.data.documentNumber,
          currency: result.data.currency,
          comment: result.data.comment,
          source: ExpenseSource.AI,
          attachmentId: attachment.id,
          aiAnalysisId: analysis.id,
          confidence: result.data.confidence,
          warnings: result.data.warnings,
          evidence: result.data.evidence,
          requiresManualReview: false,
        }
        : {
          attachmentId: attachment.id,
          aiAnalysisId: analysis.id,
          source: ExpenseSource.AI,
          warnings: result.validationErrors,
          requiresManualReview: true,
        },
    };
  }

  private async getActionableNote(user: AuthUser, id: string, permission: string) {
    const scope = permissionScope(user.permissionScopes, permission);
    if (scope !== PermissionScope.ALL) {
      throw ApiError.forbidden('Only administrators can perform this action.');
    }
    const note = await expenseRepository.findNoteById(id, {});
    if (!note) throw ApiError.notFound('Expense note');
    return note;
  }

  private async transition(
    actorId: string,
    existing: Awaited<ReturnType<typeof expenseRepository.findNoteById>> extends infer T ? NonNullable<T> : never,
    status: ExpenseNoteStatus,
    action: AuditAction,
    data: Prisma.ExpenseNoteUncheckedUpdateInput,
    reason?: string
  ) {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.expenseNote.update({
        where: { id: existing.id },
        data: { ...data, status },
        include: expenseNoteInclude,
      });
      await this.audit(tx, existing.id, actorId, action, snapshot(existing), snapshot(updated), reason);
      return tx.expenseNote.findUniqueOrThrow({ where: { id: existing.id }, include: expenseNoteInclude });
    });
  }

  private ensureCanEdit(status: ExpenseNoteStatus, scope: PermissionScope) {
    if (scope === PermissionScope.ALL) {
      if (!ADMIN_EDITABLE_STATUSES.has(status)) throw ApiError.badRequest('This expense note can no longer be edited.');
      return;
    }
    if (!EMPLOYEE_EDITABLE_STATUSES.has(status)) throw ApiError.badRequest('This expense note can no longer be edited by the employee.');
  }

  private sumFromDate(notes: Array<{ expenseDate: Date; amountTTC: Prisma.Decimal }>, startDate: Date) {
    return notes
      .filter((note) => new Date(note.expenseDate) >= startDate)
      .reduce((sum, note) => sum + Number(note.amountTTC), 0);
  }

  private groupNotes<T extends { amountTTC: Prisma.Decimal; vatAmount: Prisma.Decimal }>(
    notes: T[],
    getKey: (note: T) => string
  ) {
    const grouped = new Map<string, { key: string; count: number; amountTTC: number; vatAmount: number }>();
    notes.forEach((note) => {
      const key = getKey(note);
      const current = grouped.get(key) ?? { key, count: 0, amountTTC: 0, vatAmount: 0 };
      current.count += 1;
      current.amountTTC += Number(note.amountTTC);
      current.vatAmount += Number(note.vatAmount);
      grouped.set(key, current);
    });
    return Array.from(grouped.values()).sort((a, b) => b.amountTTC - a.amountTTC);
  }

  private async validateAttachmentOwnership(userId: string, attachmentId?: string) {
    if (!attachmentId) return;
    const attachment = await expenseRepository.findAttachmentById(attachmentId);
    if (!attachment) throw ApiError.notFound('Expense attachment');
    if (attachment.uploadedById !== userId || attachment.expenseNoteId) {
      throw ApiError.forbidden('Forbidden expense attachment.');
    }
  }

  private async validateAIAnalysisOwnership(userId: string, aiAnalysisId?: string, attachmentId?: string) {
    if (!aiAnalysisId) return;
    const analysis = await expenseRepository.findAIAnalysisById(aiAnalysisId);
    if (!analysis) throw ApiError.notFound('Expense AI analysis');
    if (analysis.requestedById !== userId || analysis.expenseNoteId) {
      throw ApiError.forbidden('Forbidden expense AI analysis.');
    }
    if (attachmentId && analysis.attachmentId !== attachmentId) {
      throw ApiError.badRequest('Expense AI analysis does not match the selected receipt.');
    }
  }

  private async removeStoredReceipt(storageKey: string) {
    try {
      await fs.unlink(resolveReceiptStorageKey(storageKey));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw error;
    }
  }

  private ensureTransition(current: ExpenseNoteStatus, allowed: ExpenseNoteStatus[]) {
    if (!allowed.includes(current)) {
      throw ApiError.badRequest(`Illegal expense note status transition from ${current}.`);
    }
  }

  private async ensureCategoryExists(id: string) {
    const category = await expenseRepository.findCategoryById(id);
    if (!category) throw ApiError.notFound('Expense category');
    return category;
  }

  private async ensureTypeExists(id: string) {
    const type = await expenseRepository.findTypeById(id);
    if (!type) throw ApiError.notFound('Expense type');
    return type;
  }

  private async validateCategoryType(categoryId: string, expenseTypeId: string) {
    const category = await this.ensureCategoryExists(categoryId);
    if (!category.active) throw ApiError.badRequest('Expense category is inactive.');
    const type = await this.ensureTypeExists(expenseTypeId);
    if (!type.active) throw ApiError.badRequest('Expense type is inactive.');
    if (type.categoryId !== categoryId) {
      throw ApiError.badRequest('Expense type does not belong to the selected category.');
    }
  }

  private async averageConfidence(analysisId: string) {
    const analysis = await expenseRepository.findAIAnalysisById(analysisId);
    if (!analysis) return undefined;
    const confidence = analysis.confidence;
    if (!confidence || typeof confidence !== 'object' || Array.isArray(confidence)) return undefined;

    const values = Object.values(confidence).filter((value): value is number => typeof value === 'number');
    if (!values.length) return undefined;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private async audit(
    tx: Prisma.TransactionClient,
    expenseNoteId: string,
    actorId: string,
    action: AuditAction,
    previousValues: Prisma.InputJsonValue | null,
    newValues: Prisma.InputJsonValue | null,
    reason?: string
  ) {
    await tx.expenseAuditLog.create({
      data: {
        expenseNoteId,
        actorId,
        action,
        previousValues: previousValues ?? undefined,
        newValues: newValues ?? undefined,
        reason,
      },
    });
  }

  private buildExpenseWhere(userId: string, scope: PermissionScope, query: Partial<ExpenseNoteQueryInput>) {
    return {
      AND: [
        expenseNoteAccessWhere(userId, scope),
        {
          ...(query.categoryId && { categoryId: query.categoryId }),
          ...(query.expenseTypeId && { expenseTypeId: query.expenseTypeId }),
          ...(query.source && { source: query.source }),
          ...(query.status && { status: query.status }),
          ...(query.employeeId && scope === PermissionScope.ALL && { createdById: query.employeeId }),
          ...(query.currency && { currency: query.currency }),
          ...(query.hasReceipt !== undefined && { attachments: query.hasReceipt ? { some: {} } : { none: {} } }),
          ...(query.hasWarnings !== undefined && { aiWarnings: query.hasWarnings ? { not: Prisma.JsonNull } : { equals: Prisma.JsonNull } }),
          ...(query.aiConfidenceMin && { aiConfidence: { gte: this.normalizeConfidenceFilter(query.aiConfidenceMin) } }),
          ...(query.amountMin || query.amountMax
            ? {
              amountTTC: {
                ...(query.amountMin && { gte: Number(query.amountMin) }),
                ...(query.amountMax && { lte: Number(query.amountMax) }),
              },
            }
            : {}),
          ...(query.dateFrom || query.dateTo
            ? {
              expenseDate: {
                ...(query.dateFrom && { gte: new Date(query.dateFrom) }),
                ...(query.dateTo && { lte: new Date(query.dateTo) }),
              },
            }
            : {}),
          ...(query.search && {
            OR: [
              { merchantName: { contains: query.search, mode: 'insensitive' as const } },
              { receiptNumber: { contains: query.search, mode: 'insensitive' as const } },
              { documentNumber: { contains: query.search, mode: 'insensitive' as const } },
              { comment: { contains: query.search, mode: 'insensitive' as const } },
              { createdBy: { name: { contains: query.search, mode: 'insensitive' as const } } },
              { createdBy: { email: { contains: query.search, mode: 'insensitive' as const } } },
              { category: { name: { contains: query.search, mode: 'insensitive' as const } } },
              { expenseType: { name: { contains: query.search, mode: 'insensitive' as const } } },
            ],
          }),
        },
      ],
    } satisfies Prisma.ExpenseNoteWhereInput;
  }

  private async findNotesForExport(userId: string, scope: PermissionScope, ids: string[] | undefined, filters: Partial<ExpenseNoteQueryInput>) {
    const where = this.buildExpenseWhere(userId, scope, filters);
    return prisma.expenseNote.findMany({
      where: {
        AND: [
          where,
          ...(ids?.length ? [{ id: { in: ids } }] : []),
        ],
      },
      include: expenseNoteInclude,
      orderBy: { expenseDate: 'desc' },
      take: 1000,
    });
  }

  private normalizeConfidenceFilter(value: string) {
    const numeric = Number(value);
    return numeric > 1 ? numeric / 100 : numeric;
  }

  private async auditBulkExport(actorId: string, notes: Array<{ id: string }>, action: AuditAction, newValues: Prisma.InputJsonValue) {
    await prisma.$transaction(notes.map((note) => prisma.expenseAuditLog.create({
      data: {
        expenseNoteId: note.id,
        actorId,
        action,
        newValues,
      },
    })));
  }

  private expenseReference(note: { id: string; documentNumber?: string | null; receiptNumber?: string | null }) {
    return note.documentNumber || note.receiptNumber || `EXP-${note.id.slice(0, 8).toUpperCase()}`;
  }

  private pdfFileName(note: { id: string; documentNumber?: string | null; receiptNumber?: string | null }) {
    return `${sanitizeFileName(this.expenseReference(note))}.pdf`;
  }
}

function snapshot(note: {
  status?: ExpenseNoteStatus;
  categoryId?: string;
  expenseTypeId?: string;
  expenseDate?: Date | string;
  amountTTC?: Prisma.Decimal | number | string;
  amountHT?: Prisma.Decimal | number | string | null;
  vatAmount?: Prisma.Decimal | number | string;
  vatRate?: Prisma.Decimal | number | string;
  merchantName?: string | null;
  receiptNumber?: string | null;
  documentNumber?: string | null;
  currency?: string;
  comment?: string | null;
}) {
  return {
    status: note.status,
    categoryId: note.categoryId,
    expenseTypeId: note.expenseTypeId,
    expenseDate: note.expenseDate instanceof Date ? note.expenseDate.toISOString() : note.expenseDate,
    amountTTC: note.amountTTC === undefined ? undefined : String(note.amountTTC),
    amountHT: note.amountHT === undefined || note.amountHT === null ? note.amountHT : String(note.amountHT),
    vatAmount: note.vatAmount === undefined ? undefined : String(note.vatAmount),
    vatRate: note.vatRate === undefined ? undefined : String(note.vatRate),
    merchantName: note.merchantName,
    receiptNumber: note.receiptNumber,
    documentNumber: note.documentNumber,
    currency: note.currency,
    comment: note.comment,
  } satisfies Prisma.InputJsonObject;
}

export const expenseService = new ExpenseService();

function cleanEmailText(value: string) {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

function cleanEmailSubject(value: string) {
  return cleanEmailText(value).replace(/[\r\n]+/g, ' ').slice(0, 255);
}

function redactEmailLog<T extends { filePath?: string | null }>(emailLog: T): Omit<T, 'filePath'> & { filePath?: null } {
  return { ...emailLog, filePath: null };
}

function defaultExpenseEmailMessage(note: { amountTTC: unknown; currency: string; expenseDate: Date; merchantName?: string | null }) {
  return [
    'Bonjour,',
    '',
    'Veuillez trouver ci-joint la note de frais.',
    `Marchand: ${note.merchantName ?? '-'}`,
    `Date: ${note.expenseDate.toISOString().slice(0, 10)}`,
    `Montant TTC: ${Number(note.amountTTC).toFixed(2)} ${note.currency}`,
    '',
    'Cordialement,',
  ].join('\n');
}

function splitEmails(value?: string | null) {
  return value?.split(',').map((email) => email.trim()).filter(Boolean) ?? [];
}

function normalizeLanguage(value: string): 'en' | 'fr' | 'ar' {
  return value === 'en' || value === 'ar' ? value : 'fr';
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-z0-9_.-]+/gi, '-').replace(/^-+|-+$/g, '') || 'expense-note';
}

function createZipBuffer(files: Array<{ name: string; buffer: Buffer }>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    files.forEach((file) => archive.append(file.buffer, { name: sanitizeFileName(file.name) }));
    void archive.finalize();
  });
}
