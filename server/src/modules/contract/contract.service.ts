import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { env } from '@config/env';
import { prisma } from '@config/database';
import { settingsService } from '@modules/settings/settings.service';
import { resolveCompanyAssetUrl } from '@modules/settings/companyAssetUpload';
import { contractAccessWhere, customerAccessWhere } from '@modules/rbac/accessScope';
import {
  ContractBillingFrequency,
  ContractBillingJobStatus,
  ContractBillingScheduleStatus,
  ContractMilestoneStatus,
  ContractPricingType,
  ContractSignatureLinkStatus,
  ContractSignatureStatus,
  ContractStatus,
  ContractTimeEntryStatus,
  InvoiceStatus,
  PermissionScope,
  Prisma,
} from '@prisma/client';
import { sendEmail } from '@services/email.service';
import { ApiError } from '@utils/ApiError';
import { ApiResponse } from '@utils/ApiResponse';
import { generateContractNumber } from '@utils/contractNumber';
import { generateInvoiceNumber } from '@utils/invoiceNumber';
import { renderContractPdfBuffer } from './contract.pdf';
import { contractRepository } from './contract.repository';
import {
  ContractBillingActionInput,
  ContractBillingScheduleItemInput,
  ContractEmailInput,
  ContractMilestoneInput,
  ContractQueryInput,
  ContractSignatureRevokeInput,
  ContractTimeEntryInput,
  ContractTimeEntryRejectInput,
  ContractTimeEntryUpdateInput,
  CreateContractInput,
  PublicSignatureInput,
  UpdateContractInput,
} from './contract.schema';

type AuthUser = {
  id: string;
  name: string;
  email: string;
};

type ContractPricingData = Pick<
  Prisma.ContractUncheckedCreateInput,
  | 'pricingType'
  | 'unitRate'
  | 'estimatedQuantity'
  | 'fixedAmount'
  | 'billingFrequency'
  | 'billingDay'
  | 'billingStartDate'
  | 'billingEndDate'
  | 'minimumBillableUnits'
  | 'includedUnits'
  | 'overtimeRate'
  | 'taxRate'
  | 'paymentTermsDays'
  | 'autoInvoiceEnabled'
  | 'nextInvoiceDate'
  | 'lastInvoiceDate'
  | 'prorationPolicy'
  | 'billingDescription'
>;

export class ContractService {
  async create(user: AuthUser, scope: PermissionScope, data: CreateContractInput) {
    const client = await contractRepository.findClientById(data.clientId, customerAccessWhere(user.id, scope));
    if (!client) throw ApiError.notFound('Client');
    this.assertDateRange(data.startDate, data.endDate);

    const template = data.templateId ? await contractRepository.findTemplateById(data.templateId) : null;
    if (data.templateId && !template) throw ApiError.notFound('Contract template');
    const content = this.resolveContent(data, template?.content);
    const contractNumber = await generateContractNumber();
    const contentHash = this.hash(content);
    const pricingData = this.pricingData(data);

    return prisma.$transaction(async (tx) => {
      const contract = await tx.contract.create({
        data: {
          contractNumber,
          clientId: client.id,
          createdById: user.id,
          status: ContractStatus.DRAFT,
          title: data.title,
          contractType: data.contractType,
          language: data.language,
          startDate: data.startDate ? new Date(data.startDate) : null,
          endDate: data.endDate ? new Date(data.endDate) : null,
          renewalType: data.renewalType,
          renewalNoticeDays: data.renewalNoticeDays ?? null,
          amount: data.amount ?? null,
          currency: data.currency,
          ...pricingData,
          summary: data.summary ?? null,
          terms: data.terms ?? null,
        },
      });

      const version = await tx.contractVersion.create({
        data: {
          contractId: contract.id,
          versionNumber: 1,
          title: data.title,
          content,
          structuredData: this.structuredData(data),
          pricingSnapshot: this.pricingSnapshot(data),
          contentHash,
          createdById: user.id,
        },
      });

      await tx.contract.update({
        where: { id: contract.id },
        data: { currentVersionId: version.id },
      });

      await tx.contractAuditLog.create({
        data: {
          contractId: contract.id,
          actorId: user.id,
          action: 'CREATED',
          newValues: { contractNumber, clientId: client.id, versionNumber: 1, pricingType: data.pricingType },
        },
      });

      return tx.contract.findUniqueOrThrow({ where: { id: contract.id }, include: contractRepository.include() });
    });
  }

  async list(userId: string, scope: PermissionScope, query: ContractQueryInput) {
    await contractRepository.markExpired();
    const page = Number(query.page ?? 1);
    const limit = Math.min(Number(query.limit ?? 20), 100);
    const filters: Prisma.ContractWhereInput[] = [contractAccessWhere(userId, scope)];
    if (query.status) filters.push({ status: query.status });
    if (query.clientId) filters.push({ clientId: query.clientId });
    if (query.dateFrom || query.dateTo) {
      filters.push({
        startDate: {
          ...(query.dateFrom && { gte: new Date(query.dateFrom) }),
          ...(query.dateTo && { lte: new Date(query.dateTo) }),
        },
      });
    }
    if (query.search) {
      filters.push({
        OR: [
          { contractNumber: { contains: query.search, mode: Prisma.QueryMode.insensitive } },
          { title: { contains: query.search, mode: Prisma.QueryMode.insensitive } },
          { client: { name: { contains: query.search, mode: Prisma.QueryMode.insensitive } } },
          { client: { company: { contains: query.search, mode: Prisma.QueryMode.insensitive } } },
        ],
      });
    }
    const where: Prisma.ContractWhereInput = { AND: filters };
    const { data, total } = await contractRepository.findAll({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
    });
    const stats = await this.countByStatus(where);
    return { data, meta: ApiResponse.buildPaginationMeta(page, limit, total), stats };
  }

  async getById(id: string, userId: string, scope: PermissionScope) {
    await contractRepository.markExpired();
    const contract = await contractRepository.findById(id, contractAccessWhere(userId, scope));
    if (!contract) throw ApiError.notFound('Contract');
    return contract;
  }

  async update(id: string, user: AuthUser, scope: PermissionScope, data: UpdateContractInput) {
    const existing = await this.getById(id, user.id, scope);
    if (existing.status !== ContractStatus.DRAFT) {
      throw ApiError.badRequest('Only draft contracts can be edited');
    }
    this.assertDateRange(data.startDate, data.endDate);
    this.assertDateRange(data.billingStartDate, data.billingEndDate);
    const nextContent = data.content ?? existing.currentVersion?.content ?? existing.terms ?? '';
    if (nextContent.trim().length < 20) throw ApiError.badRequest('Contract content is required');
    const pricingData = this.pricingData(data);

    return prisma.$transaction(async (tx) => {
      const versionNumber = (existing.versions[0]?.versionNumber ?? 0) + 1;
      const version = await tx.contractVersion.create({
        data: {
          contractId: id,
          versionNumber,
          title: data.title ?? existing.title,
          content: nextContent,
          structuredData: this.structuredData({ ...existing, ...data } as CreateContractInput),
          pricingSnapshot: this.pricingSnapshot({ ...this.contractPricingPlain(existing), ...data }),
          contentHash: this.hash(nextContent),
          createdById: user.id,
        },
      });

      const contract = await tx.contract.update({
        where: { id },
        data: {
          ...(data.title !== undefined && { title: data.title }),
          ...(data.contractType !== undefined && { contractType: data.contractType }),
          ...(data.language !== undefined && { language: data.language }),
          ...(data.startDate !== undefined && { startDate: data.startDate ? new Date(data.startDate) : null }),
          ...(data.endDate !== undefined && { endDate: data.endDate ? new Date(data.endDate) : null }),
          ...(data.renewalType !== undefined && { renewalType: data.renewalType }),
          ...(data.renewalNoticeDays !== undefined && { renewalNoticeDays: data.renewalNoticeDays ?? null }),
          ...(data.amount !== undefined && { amount: data.amount ?? null }),
          ...(data.currency !== undefined && { currency: data.currency }),
          ...pricingData,
          ...(data.summary !== undefined && { summary: data.summary ?? null }),
          ...(data.terms !== undefined && { terms: data.terms ?? null }),
          currentVersionId: version.id,
        },
        include: contractRepository.include(),
      });

      await tx.contractAuditLog.create({
        data: {
          contractId: id,
          actorId: user.id,
          action: 'UPDATED',
          previousValues: { versionId: existing.currentVersionId },
          newValues: { versionId: version.id, versionNumber, pricingType: data.pricingType ?? existing.pricingType },
        },
      });

      return contract;
    });
  }

  async deleteDraft(id: string, userId: string, scope: PermissionScope) {
    const contract = await this.getById(id, userId, scope);
    if (contract.status !== ContractStatus.DRAFT) throw ApiError.badRequest('Only draft contracts can be deleted');
    await prisma.contract.delete({ where: { id } });
  }

  async transition(id: string, user: AuthUser, scope: PermissionScope, nextStatus: ContractStatus) {
    const contract = await this.getById(id, user.id, scope);
    if (nextStatus === ContractStatus.SIGNED) {
      throw ApiError.badRequest('Contract cannot be marked as signed directly');
    }
    this.assertTransition(contract.status, nextStatus);
    const now = new Date();
    const data: Prisma.ContractUpdateInput = {
      status: nextStatus,
      sentAt: nextStatus === ContractStatus.SENT ? now : undefined,
      sentBy: nextStatus === ContractStatus.SENT ? { connect: { id: user.id } } : undefined,
      activatedAt: nextStatus === ContractStatus.ACTIVE ? now : undefined,
      terminatedAt: nextStatus === ContractStatus.TERMINATED ? now : undefined,
      cancelledAt: nextStatus === ContractStatus.CANCELLED ? now : undefined,
    };
    const updated = await prisma.contract.update({ where: { id }, data, include: contractRepository.include() });
    await prisma.contractAuditLog.create({
      data: {
        contractId: id,
        actorId: user.id,
        action: nextStatus,
        previousValues: { status: contract.status },
        newValues: { status: nextStatus },
      },
    });
    return updated;
  }

  async signForCompany(id: string, user: AuthUser, scope: PermissionScope) {
    const contract = await this.getById(id, user.id, scope);
    if (!contract.currentVersion) throw ApiError.badRequest('Contract version is required');
    const companySignableStatuses: ContractStatus[] = [ContractStatus.DRAFT, ContractStatus.SENT, ContractStatus.VIEWED];
    if (!companySignableStatuses.includes(contract.status)) {
      throw ApiError.badRequest('This contract cannot be signed');
    }
    if (contract.currentVersion.signatureStatus === ContractSignatureStatus.REVOKED || contract.currentVersion.revokedAt) {
      throw ApiError.badRequest('This contract version signature has been revoked. Create a new version before signing again.');
    }
    if (contract.currentVersion.signatureStatus !== ContractSignatureStatus.NOT_STARTED && contract.currentVersion.signatureStatus !== ContractSignatureStatus.COMPANY_PENDING) {
      throw ApiError.badRequest('This contract version is already in a signature workflow');
    }
    const company = await settingsService.getCompanySettings();
    this.assertCompanySignatureAssets(company);
    const signedAt = new Date();
    const signedContract = {
      ...contract,
      currentVersion: {
        ...contract.currentVersion,
        signatureStatus: ContractSignatureStatus.COMPANY_SIGNED,
        companySignatureUrl: company.signatureUrl,
        companyStampUrl: company.stampUrl,
        companySignedAt: signedAt,
      },
      companySignedBy: user,
      companySignedById: user.id,
      signedAt,
    };
    const pdf = await renderContractPdfBuffer(signedContract, company, contract.language);
    const pdfHash = this.hashBuffer(pdf);
    const storageKey = await this.archiveSignedPdf(contract.contractNumber, contract.currentVersion.versionNumber, pdf);
    const updated = await prisma.$transaction(async (tx) => {
      await tx.contractVersion.update({
        where: { id: contract.currentVersionId! },
        data: {
          signatureStatus: ContractSignatureStatus.COMPANY_SIGNED,
          isSigned: false,
          companySignatureUrl: company.signatureUrl,
          companyStampUrl: company.stampUrl,
          companySignedById: user.id,
          companySignedAt: signedAt,
          signedPdfHash: pdfHash,
          signedPdfStorageKey: storageKey,
        },
      });
      const next = await tx.contract.update({
        where: { id },
        data: {
          signedVersionId: contract.currentVersionId,
          companySignedById: user.id,
          signedAt,
          pdfHash,
        },
        include: contractRepository.include(),
      });
      await tx.contractAuditLog.create({
        data: {
          contractId: id,
          actorId: user.id,
          action: 'COMPANY_SIGNED',
          newValues: {
            versionId: contract.currentVersionId,
            signatureStatus: ContractSignatureStatus.COMPANY_SIGNED,
            signatureUrl: company.signatureUrl,
            stampUrl: company.stampUrl,
            pdfHash,
          },
        },
      });
      return next;
    });
    return updated;
  }

  async downloadPdf(id: string, userId: string, scope: PermissionScope, language?: string) {
    const contract = await this.getById(id, userId, scope);
    const company = await settingsService.getCompanySettings();
    const buffer = await renderContractPdfBuffer(contract, company, language ?? contract.language);
    const fileName = `${safeFileName(contract.contractNumber)}.pdf`;
    await prisma.contractAuditLog.create({ data: { contractId: id, actorId: userId, action: 'PDF_DOWNLOADED' } });
    return { buffer, fileName };
  }

  async previewPdf(id: string, userId: string, scope: PermissionScope, language?: string) {
    const contract = await this.getById(id, userId, scope);
    const company = await settingsService.getCompanySettings();
    const buffer = await renderContractPdfBuffer(contract, company, language ?? contract.language);
    const fileName = `${safeFileName(contract.contractNumber)}.pdf`;
    await prisma.contractAuditLog.create({ data: { contractId: id, actorId: userId, action: 'PDF_PREVIEWED' } });
    return { buffer, fileName };
  }

  async getEmailHistory(id: string, userId: string, scope: PermissionScope) {
    await this.getById(id, userId, scope);
    return prisma.contractEmailLog.findMany({
      where: { contractId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { sentBy: { select: { id: true, name: true, email: true } } },
    });
  }

  async revokeSignature(id: string, user: AuthUser, scope: PermissionScope, data: ContractSignatureRevokeInput) {
    const contract = await this.getById(id, user.id, scope);
    if (!contract.currentVersion) throw ApiError.badRequest('Contract version is required');
    if (!data.reason.trim()) throw ApiError.badRequest('Revocation reason is required');
    if (contract.currentVersion.signatureStatus === ContractSignatureStatus.NOT_STARTED || contract.currentVersion.signatureStatus === ContractSignatureStatus.COMPANY_PENDING) {
      throw ApiError.badRequest('There is no signature to revoke for this contract version');
    }
    if (contract.currentVersion.signatureStatus === ContractSignatureStatus.REVOKED || contract.currentVersion.revokedAt) {
      throw ApiError.badRequest('This contract version signature is already revoked');
    }
    const currentVersion = contract.currentVersion;

    const now = new Date();
    return prisma.$transaction(async (tx) => {
      await tx.contractVersion.update({
        where: { id: contract.currentVersionId! },
        data: {
          signatureStatus: ContractSignatureStatus.REVOKED,
          isSigned: false,
          revokedAt: now,
          revokedById: user.id,
          revocationReason: sanitizeText(data.reason),
          revocationNote: data.internalNote ? sanitizeText(data.internalNote) : null,
          previousPdfHash: contract.currentVersion?.signedPdfHash ?? contract.pdfHash,
        },
      });
      await tx.contractSignatureLink.updateMany({
        where: { contractId: id, status: ContractSignatureLinkStatus.ACTIVE },
        data: { status: ContractSignatureLinkStatus.REVOKED, revokedAt: now },
      });
      await tx.contract.update({
        where: { id },
        data: {
          signedVersionId: null,
          companySignedById: null,
          signedAt: null,
          pdfHash: null,
        },
      });
      await tx.contractAuditLog.create({
        data: {
          contractId: id,
          actorId: user.id,
          action: 'SIGNATURE_REVOKED',
          previousValues: {
            signatureStatus: currentVersion.signatureStatus,
            pdfHash: currentVersion.signedPdfHash ?? contract.pdfHash,
          },
          newValues: {
            signatureStatus: ContractSignatureStatus.REVOKED,
            reason: sanitizeText(data.reason),
            versionId: contract.currentVersionId,
          },
        },
      });
      return tx.contract.findUniqueOrThrow({ where: { id }, include: contractRepository.include() });
    });
  }

  async sendByEmail(id: string, user: AuthUser, scope: PermissionScope, data: ContractEmailInput, origin?: string) {
    const contract = await this.getById(id, user.id, scope);
    if (!contract.currentVersion) throw ApiError.badRequest('Contract version is required');
    if (contract.currentVersion.signatureStatus !== ContractSignatureStatus.COMPANY_SIGNED) {
      throw ApiError.badRequest('Company signature is required before sending the client signature link');
    }
    if (contract.currentVersion.revokedAt) {
      throw ApiError.badRequest('This contract version signature has been revoked');
    }
    const signatureLink = await this.createSignatureLink(id, data.to, data.signatureLinkExpiresInDays);
    const signatureUrl = origin ? `${origin.replace(/\/$/, '')}/contracts/sign/${signatureLink.token}` : `Signature token: ${signatureLink.token}`;
    const company = await settingsService.getCompanySettings();
    const pdf = await renderContractPdfBuffer(contract, company, data.pdfLanguage ?? contract.language);
    const subject = sanitizeText(data.subject ?? `Contrat ${contract.contractNumber}`);
    const message = sanitizeText(data.message ?? `Bonjour,\n\nVeuillez consulter et signer le contrat ${contract.contractNumber}.\n\n${signatureUrl}`);
    const attachmentName = `${safeFileName(contract.contractNumber)}.pdf`;

    try {
      const delivery = await sendEmail({
        to: data.to,
        cc: data.cc,
        bcc: data.bcc,
        subject,
        text: `${message}\n\n${signatureUrl}`,
        attachments: [{ filename: attachmentName, content: pdf, contentType: 'application/pdf' }],
      });
      const updated = await prisma.$transaction(async (tx) => {
        await tx.contractVersion.update({
          where: { id: contract.currentVersionId! },
          data: { signatureStatus: ContractSignatureStatus.CLIENT_PENDING },
        });
        await tx.contractEmailLog.create({
          data: {
            contractId: id,
            sentById: user.id,
            recipientEmail: data.to,
            cc: data.cc?.join(', ') ?? null,
            subject,
            message,
            pdfLanguage: data.pdfLanguage,
            attachmentName,
            status: 'SENT',
            messageId: delivery.messageId,
          },
        });
        await tx.contractAuditLog.create({
          data: {
            contractId: id,
            actorId: user.id,
            action: 'CLIENT_SIGNATURE_LINK_GENERATED',
            newValues: { recipientEmail: data.to, versionId: contract.currentVersionId },
          },
        });
        await tx.contractAuditLog.create({ data: { contractId: id, actorId: user.id, action: 'EMAIL_SENT', newValues: { recipientEmail: data.to } } });
        return tx.contract.update({
          where: { id },
          data: { status: contract.status === ContractStatus.DRAFT ? ContractStatus.SENT : contract.status, sentAt: contract.sentAt ?? new Date(), sentById: contract.sentById ?? user.id },
          include: contractRepository.include(),
        });
      });
      return { contract: updated, signatureUrl };
    } catch (error) {
      await this.expireLink(signatureLink.id);
      await prisma.contractEmailLog.create({
        data: {
          contractId: id,
          sentById: user.id,
          recipientEmail: data.to,
          cc: data.cc?.join(', ') ?? null,
          subject,
          message,
          pdfLanguage: data.pdfLanguage,
          attachmentName,
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
      });
      await prisma.contractAuditLog.create({ data: { contractId: id, actorId: user.id, action: 'EMAIL_FAILED', newValues: { recipientEmail: data.to } } });
      throw error;
    }
  }

  listTemplates(includeInactive = false) {
    return contractRepository.findTemplates(includeInactive);
  }

  async createTimeEntry(contractId: string, user: AuthUser, scope: PermissionScope, data: ContractTimeEntryInput) {
    const contract = await this.getById(contractId, user.id, scope);
    this.assertTimesheetContract(contract);
    this.assertTimesheetDate(contract, data.workDate);
    const targetUserId = scope === PermissionScope.ALL && data.userId ? data.userId : user.id;
    const billable = data.billable ?? true;
    const submit = data.submit ?? false;
    const calculated = this.calculateTimeEntry(contract, { ...data, billable, breakMinutes: data.breakMinutes ?? 0 });
    await this.assertNoTimeOverlap(contractId, targetUserId, data.workDate, data.startTime ?? null, data.endTime ?? null);
    const entry = await prisma.contractTimeEntry.create({
      data: {
        contractId,
        userId: targetUserId,
        createdById: user.id,
        workDate: new Date(data.workDate),
        startTime: data.startTime ? new Date(data.startTime) : null,
        endTime: data.endTime ? new Date(data.endTime) : null,
        breakMinutes: data.breakMinutes ?? 0,
        durationMinutes: calculated.durationMinutes,
        billableMinutes: calculated.billableMinutes,
        quantity: calculated.quantity,
        activityType: data.activityType ? sanitizeText(data.activityType) : null,
        description: sanitizeText(data.description),
        internalNote: data.internalNote ? sanitizeText(data.internalNote) : null,
        billable,
        status: submit ? ContractTimeEntryStatus.SUBMITTED : ContractTimeEntryStatus.DRAFT,
        appliedRate: calculated.appliedRate,
        currency: contract.currency,
        calculatedAmount: calculated.calculatedAmount,
        pricingSnapshot: calculated.pricingSnapshot,
        submittedById: submit ? user.id : null,
        submittedAt: submit ? new Date() : null,
      },
    });
    await prisma.contractAuditLog.create({
      data: { contractId, actorId: user.id, action: submit ? 'TIME_ENTRY_SUBMITTED' : 'TIME_ENTRY_ADDED', newValues: { entryId: entry.id, quantity: entry.quantity.toString(), amount: entry.calculatedAmount?.toString() } },
    });
    return entry;
  }

  async updateTimeEntry(contractId: string, entryId: string, user: AuthUser, scope: PermissionScope, data: ContractTimeEntryUpdateInput) {
    const contract = await this.getById(contractId, user.id, scope);
    this.assertTimesheetContract(contract);
    const entry = await prisma.contractTimeEntry.findFirst({ where: { id: entryId, contractId } });
    if (!entry) throw ApiError.notFound('Time entry');
    this.assertEntryAccess(entry, user, scope);
    if (entry.status !== ContractTimeEntryStatus.DRAFT && entry.status !== ContractTimeEntryStatus.REJECTED) {
      throw ApiError.badRequest('Only draft or rejected time entries can be edited');
    }
    const workDate = data.workDate ?? entry.workDate.toISOString().slice(0, 10);
    this.assertTimesheetDate(contract, workDate);
    const startTime = data.startTime === undefined ? entry.startTime?.toISOString() ?? null : data.startTime;
    const endTime = data.endTime === undefined ? entry.endTime?.toISOString() ?? null : data.endTime;
    await this.assertNoTimeOverlap(contractId, entry.userId, workDate, startTime, endTime, entry.id);
    const calculated = this.calculateTimeEntry(contract, {
      startTime,
      endTime,
      breakMinutes: data.breakMinutes ?? entry.breakMinutes,
      quantity: data.quantity ?? Number(entry.quantity),
      billable: data.billable ?? entry.billable,
    });
    const updated = await prisma.contractTimeEntry.update({
      where: { id: entry.id },
      data: {
        workDate: new Date(workDate),
        startTime: startTime ? new Date(startTime) : null,
        endTime: endTime ? new Date(endTime) : null,
        breakMinutes: data.breakMinutes ?? entry.breakMinutes,
        durationMinutes: calculated.durationMinutes,
        billableMinutes: calculated.billableMinutes,
        quantity: calculated.quantity,
        activityType: data.activityType === undefined ? entry.activityType : data.activityType ? sanitizeText(data.activityType) : null,
        description: data.description ? sanitizeText(data.description) : entry.description,
        internalNote: data.internalNote === undefined ? entry.internalNote : data.internalNote ? sanitizeText(data.internalNote) : null,
        billable: data.billable ?? entry.billable,
        status: ContractTimeEntryStatus.DRAFT,
        appliedRate: calculated.appliedRate,
        currency: contract.currency,
        calculatedAmount: calculated.calculatedAmount,
        pricingSnapshot: calculated.pricingSnapshot,
        rejectionReason: null,
        rejectedById: null,
        rejectedAt: null,
      },
    });
    await prisma.contractAuditLog.create({ data: { contractId, actorId: user.id, action: 'TIME_ENTRY_UPDATED', previousValues: { entryId }, newValues: { entryId: updated.id } } });
    return updated;
  }

  async submitTimeEntry(contractId: string, entryId: string, user: AuthUser, scope: PermissionScope) {
    await this.getById(contractId, user.id, scope);
    const entry = await prisma.contractTimeEntry.findFirst({ where: { id: entryId, contractId } });
    if (!entry) throw ApiError.notFound('Time entry');
    this.assertEntryAccess(entry, user, scope);
    if (entry.status !== ContractTimeEntryStatus.DRAFT && entry.status !== ContractTimeEntryStatus.REJECTED) {
      throw ApiError.badRequest('Only draft or rejected time entries can be submitted');
    }
    const updated = await prisma.contractTimeEntry.update({
      where: { id: entry.id },
      data: { status: ContractTimeEntryStatus.SUBMITTED, submittedById: user.id, submittedAt: new Date(), rejectionReason: null },
    });
    await prisma.contractAuditLog.create({ data: { contractId, actorId: user.id, action: 'TIME_ENTRY_SUBMITTED', newValues: { entryId } } });
    return updated;
  }

  async approveTimeEntry(contractId: string, entryId: string, user: AuthUser, scope: PermissionScope) {
    await this.getById(contractId, user.id, scope);
    const entry = await prisma.contractTimeEntry.findFirst({ where: { id: entryId, contractId } });
    if (!entry) throw ApiError.notFound('Time entry');
    if (entry.invoiceId || entry.status === ContractTimeEntryStatus.INVOICED) throw ApiError.badRequest('Invoiced time entries cannot be approved again');
    if (entry.status !== ContractTimeEntryStatus.SUBMITTED) throw ApiError.badRequest('Only submitted time entries can be approved');
    const updated = await prisma.contractTimeEntry.update({
      where: { id: entryId },
      data: { status: ContractTimeEntryStatus.APPROVED, approvedById: user.id, approvedAt: new Date() },
    });
    await prisma.contractAuditLog.create({
      data: { contractId, actorId: user.id, action: 'TIME_ENTRY_APPROVED', newValues: { entryId } },
    });
    return updated;
  }

  async rejectTimeEntry(contractId: string, entryId: string, user: AuthUser, scope: PermissionScope, data: ContractTimeEntryRejectInput) {
    await this.getById(contractId, user.id, scope);
    const entry = await prisma.contractTimeEntry.findFirst({ where: { id: entryId, contractId } });
    if (!entry) throw ApiError.notFound('Time entry');
    if (entry.invoiceId || entry.status === ContractTimeEntryStatus.INVOICED || entry.status === ContractTimeEntryStatus.LOCKED) {
      throw ApiError.badRequest('This time entry cannot be rejected');
    }
    if (entry.status !== ContractTimeEntryStatus.SUBMITTED) throw ApiError.badRequest('Only submitted time entries can be rejected');
    const updated = await prisma.contractTimeEntry.update({
      where: { id: entryId },
      data: { status: ContractTimeEntryStatus.REJECTED, rejectedById: user.id, rejectedAt: new Date(), rejectionReason: sanitizeText(data.reason) },
    });
    await prisma.contractAuditLog.create({
      data: { contractId, actorId: user.id, action: 'TIME_ENTRY_REJECTED', newValues: { entryId, reason: data.reason } },
    });
    return updated;
  }

  async createMilestone(contractId: string, user: AuthUser, scope: PermissionScope, data: ContractMilestoneInput) {
    const contract = await this.getById(contractId, user.id, scope);
    if (contract.pricingType !== ContractPricingType.MILESTONE) throw ApiError.badRequest('Milestones are only available for milestone contracts');
    await this.assertMilestoneLimit(contractId, data.amount, data.percentage);
    const milestone = await prisma.contractMilestone.create({
      data: {
        contractId,
        title: sanitizeText(data.title),
        description: data.description ? sanitizeText(data.description) : null,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        amount: data.amount == null ? null : new Prisma.Decimal(data.amount),
        percentage: data.percentage == null ? null : new Prisma.Decimal(data.percentage),
        status: data.status ?? ContractMilestoneStatus.PENDING,
        sortOrder: data.sortOrder,
      },
    });
    await prisma.contractAuditLog.create({ data: { contractId, actorId: user.id, action: 'MILESTONE_CREATED', newValues: { milestoneId: milestone.id } } });
    return milestone;
  }

  async approveMilestone(contractId: string, milestoneId: string, user: AuthUser, scope: PermissionScope) {
    await this.getById(contractId, user.id, scope);
    const milestone = await prisma.contractMilestone.findFirst({ where: { id: milestoneId, contractId } });
    if (!milestone) throw ApiError.notFound('Milestone');
    if (milestone.invoiceId || milestone.status === ContractMilestoneStatus.INVOICED) throw ApiError.badRequest('Invoiced milestones cannot be approved again');
    const updated = await prisma.contractMilestone.update({
      where: { id: milestoneId },
      data: { status: ContractMilestoneStatus.APPROVED, approvedById: user.id, approvedAt: new Date() },
    });
    await prisma.contractAuditLog.create({ data: { contractId, actorId: user.id, action: 'MILESTONE_APPROVED', newValues: { milestoneId } } });
    return updated;
  }

  async createBillingScheduleItem(contractId: string, user: AuthUser, scope: PermissionScope, data: ContractBillingScheduleItemInput) {
    const contract = await this.getById(contractId, user.id, scope);
    if (contract.pricingType !== ContractPricingType.FIXED && contract.pricingType !== ContractPricingType.CUSTOM) {
      throw ApiError.badRequest('Billing schedules are only available for fixed or custom contracts');
    }
    const item = await prisma.contractBillingScheduleItem.create({
      data: {
        contractId,
        label: sanitizeText(data.label),
        dueDate: new Date(data.dueDate),
        amount: new Prisma.Decimal(data.amount),
        status: data.status ?? ContractBillingScheduleStatus.PENDING,
        sortOrder: data.sortOrder,
      },
    });
    await prisma.contractAuditLog.create({ data: { contractId, actorId: user.id, action: 'BILLING_SCHEDULE_CREATED', newValues: { scheduleItemId: item.id } } });
    return item;
  }

  async generateBillingInvoice(contractId: string, user: AuthUser, scope: PermissionScope, data: ContractBillingActionInput = {}) {
    const contract = await this.getById(contractId, user.id, scope);
    this.assertInvoiceableContract(contract);
    try {
      const invoice = await prisma.$transaction(async (tx) => {
        const billing = await this.resolveBillingSource(tx, contract, data);
        const existingInvoice = await tx.invoice.findFirst({
          where: {
            contractId: contract.id,
            billingPeriodStart: billing.periodStart,
            billingPeriodEnd: billing.periodEnd,
          },
          select: { id: true, invoiceNumber: true },
        });
        if (existingInvoice) {
          throw ApiError.conflict(`Invoice ${existingInvoice.invoiceNumber} already exists for this contract billing period`);
        }
        const invoiceNumber = await generateInvoiceNumber();
        const issueDate = new Date();
        const dueDate = new Date(issueDate);
        dueDate.setDate(dueDate.getDate() + contract.paymentTermsDays);
        const taxRate = new Prisma.Decimal(contract.taxRate ?? 0);
        const subtotal = billing.amount;
        const taxAmount = subtotal.mul(taxRate).div(100).toDecimalPlaces(2);
        const total = subtotal.plus(taxAmount).toDecimalPlaces(2);
        const invoice = await tx.invoice.create({
          data: {
            customerId: contract.clientId,
            createdById: user.id,
            invoiceNumber,
            status: InvoiceStatus.DRAFT,
            issueDate,
            dueDate,
            subtotal,
            taxRate,
            taxAmount,
            customerCountry: contract.client.country ?? 'Morocco',
            customerCountryCode: contract.client.countryCode ?? 'MA',
            discount: new Prisma.Decimal(0),
            total,
            amountPaid: new Prisma.Decimal(0),
            balanceDue: total,
            notes: `Contract ${contract.contractNumber}`,
            terms: contract.terms,
            currency: contract.currency,
            contractId: contract.id,
            contractVersionId: contract.currentVersionId,
            billingPeriodStart: billing.periodStart,
            billingPeriodEnd: billing.periodEnd,
            contractMilestoneId: billing.milestoneId,
            contractBillingScheduleItemId: billing.scheduleItemId,
            items: {
              create: [{
                description: billing.description,
                unit: billing.unit,
                quantity: billing.quantity,
                unitPrice: billing.unitPrice,
                taxRate,
                total: subtotal,
                sortOrder: 1,
              }],
            },
          },
          include: { items: true, customer: true },
        });

        if (billing.timeEntryIds.length) {
          await tx.contractTimeEntry.updateMany({
            where: { id: { in: billing.timeEntryIds }, invoiceId: null },
            data: { invoiceId: invoice.id, status: ContractTimeEntryStatus.INVOICED, invoicedAt: issueDate },
          });
        }
        if (billing.milestoneId) {
          await tx.contractMilestone.update({
            where: { id: billing.milestoneId },
            data: { invoiceId: invoice.id, status: ContractMilestoneStatus.INVOICED, invoicedAt: issueDate },
          });
        }
        if (billing.scheduleItemId) {
          await tx.contractBillingScheduleItem.update({
            where: { id: billing.scheduleItemId },
            data: { invoiceId: invoice.id, status: ContractBillingScheduleStatus.INVOICED, invoicedAt: issueDate },
          });
        }
        await tx.contract.update({
          where: { id: contract.id },
          data: { lastInvoiceDate: issueDate, nextInvoiceDate: this.nextInvoiceDate(contract, issueDate) },
        });
        await tx.contractBillingJob.create({
          data: { contractId: contract.id, triggeredById: user.id, invoiceId: invoice.id, status: ContractBillingJobStatus.SUCCESS, periodStart: billing.periodStart, periodEnd: billing.periodEnd },
        });
        await tx.contractAuditLog.create({
          data: { contractId: contract.id, actorId: user.id, action: 'INVOICE_GENERATED', newValues: { invoiceId: invoice.id, invoiceNumber, ...billing.audit } },
        });
        return invoice;
      });
      return invoice;
    } catch (error) {
      await prisma.contractBillingJob.create({
        data: {
          contractId: contract.id,
          triggeredById: user.id,
          status: ContractBillingJobStatus.FAILED,
          periodStart: data.periodStart ? new Date(data.periodStart) : null,
          periodEnd: data.periodEnd ? new Date(data.periodEnd) : null,
          errorMessage: error instanceof Error ? error.message : 'Unknown billing error',
        },
      });
      await prisma.contractAuditLog.create({ data: { contractId: contract.id, actorId: user.id, action: 'AUTO_INVOICE_FAILED', newValues: { error: error instanceof Error ? error.message : 'Unknown billing error' } } });
      throw error;
    }
  }

  async getPublicContract(token: string, ipAddress?: string, userAgent?: string) {
    const tokenHash = this.hash(token);
    const link = await prisma.contractSignatureLink.findUnique({
      where: { tokenHash },
      include: { contract: { include: contractRepository.include() } },
    });
    if (!link) throw ApiError.notFound('Signature link');
    if (link.status !== ContractSignatureLinkStatus.ACTIVE || link.expiresAt < new Date()) {
      await this.expireLink(link.id);
      throw ApiError.forbidden('Signature link is expired or unavailable');
    }
    await prisma.$transaction(async (tx) => {
      await tx.contractSignatureLink.update({ where: { id: link.id }, data: { viewedAt: link.viewedAt ?? new Date(), ipAddress, userAgent } });
      if (link.contract.status === ContractStatus.SENT) {
        await tx.contract.update({ where: { id: link.contractId }, data: { status: ContractStatus.VIEWED, viewedAt: new Date() } });
      }
      await tx.contractAuditLog.create({ data: { contractId: link.contractId, action: 'CLIENT_VIEWED', ipAddress, userAgent } });
    });
    return link.contract;
  }

  async signPublicContract(token: string, data: PublicSignatureInput, ipAddress?: string, userAgent?: string) {
    const tokenHash = this.hash(token);
    const link = await prisma.contractSignatureLink.findUnique({
      where: { tokenHash },
      include: { contract: { include: contractRepository.include() } },
    });
    if (!link) throw ApiError.notFound('Signature link');
    if (link.status !== ContractSignatureLinkStatus.ACTIVE || link.expiresAt < new Date()) {
      await this.expireLink(link.id);
      throw ApiError.forbidden('Signature link is expired or unavailable');
    }
    if (link.recipientEmail.toLowerCase() !== data.signerEmail.toLowerCase()) {
      throw ApiError.forbidden('Signer email does not match this signature link');
    }
    if (!link.contract.currentVersionId) throw ApiError.badRequest('Contract version is required');
    if (!link.contract.currentVersion) throw ApiError.badRequest('Contract version is required');
    if (link.contract.currentVersion.revokedAt || link.contract.currentVersion.signatureStatus === ContractSignatureStatus.REVOKED) {
      throw ApiError.badRequest('This contract version signature has been revoked');
    }
    if (link.contract.currentVersion.signatureStatus !== ContractSignatureStatus.CLIENT_PENDING) {
      throw ApiError.badRequest('Client signature is not pending for this contract version');
    }
    const company = await settingsService.getCompanySettings();
    const signedAt = new Date();
    const signedContract = {
      ...link.contract,
      currentVersion: {
        ...link.contract.currentVersion,
        signatureStatus: ContractSignatureStatus.COMPLETED,
        clientSignerName: data.signerName,
        clientSignerEmail: data.signerEmail,
        clientSignedAt: signedAt,
      },
      signedAt,
    };
    const pdf = await renderContractPdfBuffer(signedContract, company, link.contract.language);
    const pdfHash = this.hashBuffer(pdf);
    const storageKey = await this.archiveSignedPdf(link.contract.contractNumber, link.contract.currentVersion.versionNumber, pdf);
    return prisma.$transaction(async (tx) => {
      await tx.contractVersion.update({
        where: { id: link.contract.currentVersionId! },
        data: {
          signatureStatus: ContractSignatureStatus.COMPLETED,
          isSigned: true,
          clientSignerName: data.signerName,
          clientSignerEmail: data.signerEmail,
          clientSignedAt: signedAt,
          signedPdfHash: pdfHash,
          signedPdfStorageKey: storageKey,
        },
      });
      await tx.contractSignatureLink.update({
        where: { id: link.id },
        data: { status: ContractSignatureLinkStatus.USED, usedAt: signedAt, ipAddress, userAgent },
      });
      const contract = await tx.contract.update({
        where: { id: link.contractId },
        data: {
          status: ContractStatus.ACTIVE,
          signedVersionId: link.contract.currentVersionId,
          signedAt,
          activatedAt: signedAt,
          pdfHash,
        },
        include: contractRepository.include(),
      });
      await tx.contractAuditLog.create({
        data: {
          contractId: link.contractId,
          action: 'CLIENT_SIGNED',
          newValues: { signerName: data.signerName, signerEmail: data.signerEmail, versionId: link.contract.currentVersionId, pdfHash },
          ipAddress,
          userAgent,
        },
      });
      await tx.contractAuditLog.create({
        data: {
          contractId: link.contractId,
          action: 'FINAL_SIGNED_PDF_GENERATED',
          newValues: { versionId: link.contract.currentVersionId, pdfHash, storageKey },
          ipAddress,
          userAgent,
        },
      });
      return contract;
    });
  }

  private assertTimesheetContract(contract: Awaited<ReturnType<ContractService['getById']>>) {
    if (!this.isTimeEntryPricingType(contract.pricingType)) {
      throw ApiError.badRequest('Time entries are only available for time-based contracts');
    }
    if (!['ACTIVE', 'SIGNED', 'SENT', 'VIEWED'].includes(contract.status)) {
      throw ApiError.badRequest('Time entries require an active or signed contract');
    }
  }

  private assertTimesheetDate(contract: Awaited<ReturnType<ContractService['getById']>>, workDate: string) {
    const date = new Date(workDate);
    const start = contract.startDate ? new Date(contract.startDate) : null;
    const end = contract.endDate ? new Date(contract.endDate) : null;
    start?.setHours(0, 0, 0, 0);
    end?.setHours(23, 59, 59, 999);
    if ((start && date < start) || (end && date > end)) {
      throw ApiError.badRequest('Time entry date must be inside the contract period');
    }
  }

  private calculateTimeEntry(contract: Awaited<ReturnType<ContractService['getById']>>, data: Pick<ContractTimeEntryInput, 'startTime' | 'endTime' | 'breakMinutes' | 'quantity' | 'billable'>) {
    const hasTimeRange = contract.pricingType === ContractPricingType.HOURLY && Boolean(data.startTime && data.endTime);
    const unitMinutes = this.timeEntryUnitMinutes(contract.pricingType);
    const rawMinutes = hasTimeRange
      ? Math.max(0, Math.round((new Date(data.endTime!).getTime() - new Date(data.startTime!).getTime()) / 60000))
      : Math.round(Number(data.quantity ?? 0) * unitMinutes);
    const durationMinutes = Math.max(1, rawMinutes - (data.breakMinutes ?? 0));
    const billableMinutes = data.billable ? durationMinutes : 0;
    const quantity = new Prisma.Decimal(data.quantity ?? (billableMinutes / unitMinutes)).toDecimalPlaces(2);
    const appliedRate = new Prisma.Decimal(contract.unitRate ?? contract.fixedAmount ?? contract.amount ?? 0);
    const calculatedAmount = data.billable ? quantity.mul(appliedRate).toDecimalPlaces(2) : new Prisma.Decimal(0);
    return {
      durationMinutes,
      billableMinutes,
      quantity,
      appliedRate,
      calculatedAmount,
      pricingSnapshot: {
        pricingType: contract.pricingType,
        unitRate: appliedRate.toString(),
        currency: contract.currency,
        taxRate: contract.taxRate?.toString() ?? '0',
        calculatedAt: new Date().toISOString(),
      },
    };
  }

  private async assertNoTimeOverlap(contractId: string, userId: string, workDate: string, startTime?: string | null, endTime?: string | null, excludeEntryId?: string) {
    if (!startTime || !endTime) return;
    const overlapping = await prisma.contractTimeEntry.findFirst({
      where: {
        contractId,
        userId,
        workDate: new Date(workDate),
        id: excludeEntryId ? { not: excludeEntryId } : undefined,
        status: { notIn: [ContractTimeEntryStatus.REJECTED, ContractTimeEntryStatus.INVOICED, ContractTimeEntryStatus.LOCKED] },
        startTime: { lt: new Date(endTime) },
        endTime: { gt: new Date(startTime) },
      },
      select: { id: true },
    });
    if (overlapping) throw ApiError.conflict('This time entry overlaps an existing entry');
  }

  private assertEntryAccess(entry: { userId: string; createdById: string }, user: AuthUser, scope: PermissionScope) {
    if (scope === PermissionScope.OWN && entry.userId !== user.id && entry.createdById !== user.id) {
      throw ApiError.forbidden('You can only manage your own time entries');
    }
  }

  private async resolveBillingSource(tx: Prisma.TransactionClient, contract: Awaited<ReturnType<ContractService['getById']>>, data: ContractBillingActionInput) {
    const unitRate = new Prisma.Decimal(contract.unitRate ?? contract.fixedAmount ?? contract.amount ?? 0);
    const periodStart = data.periodStart ? new Date(data.periodStart) : (contract.nextInvoiceDate ?? contract.billingStartDate ?? new Date());
    const periodEnd = data.periodEnd ? new Date(data.periodEnd) : this.defaultPeriodEnd(contract, periodStart);

    if (data.milestoneId) {
      const milestone = await tx.contractMilestone.findFirst({ where: { id: data.milestoneId, contractId: contract.id } });
      if (!milestone) throw ApiError.notFound('Milestone');
      if (milestone.status !== ContractMilestoneStatus.APPROVED) throw ApiError.badRequest('Only approved milestones can be invoiced');
      if (milestone.invoiceId) throw ApiError.conflict('This milestone is already invoiced');
      const amount = milestone.amount ?? new Prisma.Decimal(contract.fixedAmount ?? contract.amount ?? 0).mul(milestone.percentage ?? 0).div(100);
      if (amount.lte(0)) throw ApiError.badRequest('Milestone amount must be positive');
      return {
        amount,
        description: milestone.title,
        quantity: new Prisma.Decimal(1),
        unit: 'milestone',
        unitPrice: amount,
        periodStart: milestone.dueDate,
        periodEnd: milestone.dueDate,
        milestoneId: milestone.id,
        scheduleItemId: null,
        timeEntryIds: [],
        audit: { milestoneId: milestone.id },
      };
    }

    if (data.scheduleItemId) {
      const item = await tx.contractBillingScheduleItem.findFirst({ where: { id: data.scheduleItemId, contractId: contract.id } });
      if (!item) throw ApiError.notFound('Billing schedule item');
      if (item.status !== ContractBillingScheduleStatus.PENDING && item.status !== ContractBillingScheduleStatus.APPROVED) throw ApiError.badRequest('This schedule item cannot be invoiced');
      if (item.invoiceId) throw ApiError.conflict('This schedule item is already invoiced');
      return {
        amount: item.amount,
        description: item.label,
        quantity: new Prisma.Decimal(1),
        unit: 'schedule',
        unitPrice: item.amount,
        periodStart: item.dueDate,
        periodEnd: item.dueDate,
        milestoneId: null,
        scheduleItemId: item.id,
        timeEntryIds: [],
        audit: { scheduleItemId: item.id },
      };
    }

    if (this.isTimeEntryPricingType(contract.pricingType)) {
      const entries = await tx.contractTimeEntry.findMany({
        where: {
          contractId: contract.id,
          billable: true,
          status: ContractTimeEntryStatus.APPROVED,
          invoiceId: null,
          workDate: { gte: periodStart, lte: periodEnd },
        },
      });
      if (entries.length) {
        const quantity = entries.reduce((sum, entry) => sum.plus(entry.quantity), new Prisma.Decimal(0));
        const amount = entries.reduce((sum, entry) => {
          return sum.plus(entry.calculatedAmount ?? entry.quantity.mul(unitRate));
        }, new Prisma.Decimal(0)).toDecimalPlaces(2);
        return {
          amount,
          description: `${contract.title} (${formatDateOnly(periodStart)} - ${formatDateOnly(periodEnd)})`,
          quantity,
          unit: this.timeEntryInvoiceUnit(contract.pricingType),
          unitPrice: unitRate,
          periodStart,
          periodEnd,
          milestoneId: null,
          scheduleItemId: null,
          timeEntryIds: entries.map((entry) => entry.id),
          audit: { timeEntryCount: entries.length, quantity: quantity.toString() },
        };
      }
      if (contract.pricingType === ContractPricingType.HOURLY || contract.pricingType === ContractPricingType.DAILY) {
        throw ApiError.badRequest('No approved uninvoiced entries for this billing period');
      }
    }

    if (contract.pricingType === ContractPricingType.MILESTONE) {
      throw ApiError.badRequest('Select an approved milestone to generate an invoice');
    }

    if (contract.pricingType === ContractPricingType.CUSTOM) {
      throw ApiError.badRequest('Select a billing schedule item to generate an invoice');
    }

    const amount = this.resolvePeriodAmount(contract, periodStart, periodEnd);
    return {
      amount,
      description: `${contract.title} (${formatDateOnly(periodStart)} - ${formatDateOnly(periodEnd)})`,
      quantity: new Prisma.Decimal(1),
      unit: 'period',
      unitPrice: amount,
      periodStart,
      periodEnd,
      milestoneId: null,
      scheduleItemId: null,
      timeEntryIds: [],
      audit: { periodStart, periodEnd },
    };
  }

  private isTimeEntryPricingType(pricingType: ContractPricingType) {
    const timeEntryPricingTypes: ContractPricingType[] = [
      ContractPricingType.HOURLY,
      ContractPricingType.DAILY,
      ContractPricingType.MONTHLY,
      ContractPricingType.MONTHLY_SUBSCRIPTION,
      ContractPricingType.ANNUAL_SUBSCRIPTION,
    ];
    return timeEntryPricingTypes.includes(pricingType);
  }

  private timeEntryUnitMinutes(pricingType: ContractPricingType) {
    switch (pricingType) {
      case ContractPricingType.DAILY:
        return 480;
      case ContractPricingType.MONTHLY:
      case ContractPricingType.MONTHLY_SUBSCRIPTION:
        return 30 * 480;
      case ContractPricingType.ANNUAL_SUBSCRIPTION:
        return 365 * 480;
      case ContractPricingType.HOURLY:
      default:
        return 60;
    }
  }

  private timeEntryInvoiceUnit(pricingType: ContractPricingType) {
    switch (pricingType) {
      case ContractPricingType.DAILY:
        return 'day';
      case ContractPricingType.MONTHLY:
      case ContractPricingType.MONTHLY_SUBSCRIPTION:
        return 'month';
      case ContractPricingType.ANNUAL_SUBSCRIPTION:
        return 'year';
      case ContractPricingType.HOURLY:
      default:
        return 'hour';
    }
  }

  private resolvePeriodAmount(contract: Awaited<ReturnType<ContractService['getById']>>, periodStart: Date, periodEnd: Date) {
    if (contract.pricingType === ContractPricingType.FIXED) {
      return new Prisma.Decimal(contract.fixedAmount ?? contract.amount ?? 0);
    }
    const amount = new Prisma.Decimal(contract.unitRate ?? contract.fixedAmount ?? contract.amount ?? 0);
    if (amount.lte(0)) throw ApiError.badRequest('Contract billing amount is required');
    if (contract.pricingType === ContractPricingType.MONTHLY && contract.prorationPolicy !== 'NONE') {
      const daysInPeriod = Math.max(1, Math.ceil((periodEnd.getTime() - periodStart.getTime()) / 86_400_000) + 1);
      const basis = contract.prorationPolicy === 'FIXED_30_DAYS' ? 30 : new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 0).getDate();
      return amount.mul(daysInPeriod).div(basis).toDecimalPlaces(2);
    }
    return amount;
  }

  private defaultPeriodEnd(contract: Awaited<ReturnType<ContractService['getById']>>, periodStart: Date) {
    const end = new Date(periodStart);
    switch (contract.billingFrequency) {
      case ContractBillingFrequency.WEEKLY:
        end.setDate(end.getDate() + 6);
        break;
      case ContractBillingFrequency.QUARTERLY:
        end.setMonth(end.getMonth() + 3);
        end.setDate(end.getDate() - 1);
        break;
      case ContractBillingFrequency.SEMIANNUAL:
        end.setMonth(end.getMonth() + 6);
        end.setDate(end.getDate() - 1);
        break;
      case ContractBillingFrequency.ANNUAL:
        end.setFullYear(end.getFullYear() + 1);
        end.setDate(end.getDate() - 1);
        break;
      case ContractBillingFrequency.MONTHLY:
      default:
        end.setMonth(end.getMonth() + 1);
        end.setDate(end.getDate() - 1);
        break;
    }
    return contract.billingEndDate && end > contract.billingEndDate ? contract.billingEndDate : end;
  }

  private nextInvoiceDate(contract: Awaited<ReturnType<ContractService['getById']>>, from: Date) {
    if (!contract.autoInvoiceEnabled) return null;
    const next = new Date(from);
    switch (contract.billingFrequency) {
      case ContractBillingFrequency.WEEKLY:
        next.setDate(next.getDate() + 7);
        break;
      case ContractBillingFrequency.MONTHLY:
        next.setMonth(next.getMonth() + 1);
        break;
      case ContractBillingFrequency.QUARTERLY:
        next.setMonth(next.getMonth() + 3);
        break;
      case ContractBillingFrequency.SEMIANNUAL:
        next.setMonth(next.getMonth() + 6);
        break;
      case ContractBillingFrequency.ANNUAL:
        next.setFullYear(next.getFullYear() + 1);
        break;
      default:
        return null;
    }
    return contract.billingEndDate && next > contract.billingEndDate ? null : next;
  }

  private assertInvoiceableContract(contract: Awaited<ReturnType<ContractService['getById']>>) {
    if (contract.status !== ContractStatus.ACTIVE && contract.status !== ContractStatus.SENT && contract.status !== ContractStatus.VIEWED) {
      throw ApiError.badRequest('Only active or sent contracts can be invoiced');
    }
    if (contract.currentVersion?.signatureStatus !== ContractSignatureStatus.COMPLETED) {
      throw ApiError.badRequest('Contract signature workflow is incomplete');
    }
  }

  private async assertMilestoneLimit(contractId: string, amount?: number, percentage?: number | null) {
    const contract = await prisma.contract.findUnique({ where: { id: contractId }, select: { fixedAmount: true, amount: true } });
    const totals = await prisma.contractMilestone.aggregate({
      where: { contractId, status: { not: ContractMilestoneStatus.CANCELLED } },
      _sum: { amount: true, percentage: true },
    });
    if (percentage != null && new Prisma.Decimal(totals._sum.percentage ?? 0).plus(percentage).gt(100)) {
      throw ApiError.badRequest('Milestone percentages cannot exceed 100%');
    }
    const maxAmount = contract?.fixedAmount ?? contract?.amount;
    if (amount != null && maxAmount && new Prisma.Decimal(totals._sum.amount ?? 0).plus(amount).gt(maxAmount)) {
      throw ApiError.badRequest('Milestone amounts cannot exceed the contract amount');
    }
  }

  private async createSignatureLink(contractId: string, recipientEmail: string, expiresInDays: number) {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);
    const link = await prisma.contractSignatureLink.create({
      data: {
        contractId,
        tokenHash: this.hash(token),
        recipientEmail,
        status: ContractSignatureLinkStatus.ACTIVE,
        expiresAt,
      },
    });
    return { id: link.id, token };
  }

  private async expireLink(id: string) {
    await prisma.contractSignatureLink.updateMany({
      where: { id, status: ContractSignatureLinkStatus.ACTIVE },
      data: { status: ContractSignatureLinkStatus.EXPIRED },
    });
  }

  private assertDateRange(startDate?: string, endDate?: string) {
    if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
      throw ApiError.badRequest('End date must be after start date');
    }
  }

  private async countByStatus(where: Prisma.ContractWhereInput) {
    const rows = await prisma.contract.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });
    const stats: Record<string, number> = {
      DRAFT: 0,
      SENT: 0,
      VIEWED: 0,
      ACTIVE: 0,
      EXPIRED: 0,
      TERMINATED: 0,
      CANCELLED: 0,
      SIGNATURE_PENDING: 0,
    };
    for (const row of rows) {
      if (row.status !== ContractStatus.SIGNED) {
        stats[row.status] = row._count._all;
      }
    }
    stats.SIGNATURE_PENDING = await prisma.contract.count({
      where: {
        AND: [
          where,
          {
            currentVersion: {
              signatureStatus: {
                in: [
                  ContractSignatureStatus.COMPANY_PENDING,
                  ContractSignatureStatus.COMPANY_SIGNED,
                  ContractSignatureStatus.CLIENT_PENDING,
                  ContractSignatureStatus.CLIENT_SIGNED,
                ],
              },
            },
            status: { notIn: [ContractStatus.CANCELLED, ContractStatus.EXPIRED, ContractStatus.TERMINATED, ContractStatus.SIGNED] },
          },
        ],
      },
    });
    return stats;
  }

  private assertTransition(current: ContractStatus, next: ContractStatus) {
    const allowed: Record<ContractStatus, ContractStatus[]> = {
      DRAFT: [ContractStatus.SENT, ContractStatus.CANCELLED],
      SENT: [ContractStatus.VIEWED, ContractStatus.CANCELLED],
      VIEWED: [ContractStatus.CANCELLED],
      SIGNED: [],
      ACTIVE: [ContractStatus.EXPIRED, ContractStatus.TERMINATED],
      EXPIRED: [],
      TERMINATED: [],
      CANCELLED: [],
    };
    if (!allowed[current].includes(next)) {
      throw ApiError.badRequest(`Invalid contract transition from ${current} to ${next}`);
    }
  }

  private resolveContent(data: CreateContractInput, templateContent?: string) {
    const content = data.content ?? data.terms ?? templateContent;
    if (!content || content.trim().length < 20) throw ApiError.badRequest('Contract content is required');
    return content;
  }

  private structuredData(data: Partial<CreateContractInput>) {
    return {
      contractType: data.contractType,
      language: data.language,
      startDate: data.startDate,
      endDate: data.endDate,
      renewalType: data.renewalType,
      amount: data.amount,
      currency: data.currency,
    };
  }

  private pricingData(data: Partial<CreateContractInput>): Partial<ContractPricingData> {
    const result: Partial<ContractPricingData> = {};
    const money = (value: number | null | undefined) => (value == null ? null : new Prisma.Decimal(value));
    if (data.pricingType !== undefined) result.pricingType = data.pricingType;
    if (data.unitRate !== undefined) result.unitRate = money(data.unitRate);
    if (data.estimatedQuantity !== undefined) result.estimatedQuantity = money(data.estimatedQuantity);
    if (data.fixedAmount !== undefined) result.fixedAmount = money(data.fixedAmount);
    if (data.billingFrequency !== undefined) result.billingFrequency = data.billingFrequency;
    if (data.billingDay !== undefined) result.billingDay = data.billingDay ?? null;
    if (data.billingStartDate !== undefined) result.billingStartDate = data.billingStartDate ? new Date(data.billingStartDate) : null;
    if (data.billingEndDate !== undefined) result.billingEndDate = data.billingEndDate ? new Date(data.billingEndDate) : null;
    if (data.minimumBillableUnits !== undefined) result.minimumBillableUnits = money(data.minimumBillableUnits);
    if (data.includedUnits !== undefined) result.includedUnits = money(data.includedUnits);
    if (data.overtimeRate !== undefined) result.overtimeRate = money(data.overtimeRate);
    if (data.taxRate !== undefined) result.taxRate = new Prisma.Decimal(data.taxRate);
    if (data.paymentTermsDays !== undefined) result.paymentTermsDays = data.paymentTermsDays;
    if (data.autoInvoiceEnabled !== undefined) result.autoInvoiceEnabled = data.autoInvoiceEnabled;
    if (data.nextInvoiceDate !== undefined) result.nextInvoiceDate = data.nextInvoiceDate ? new Date(data.nextInvoiceDate) : null;
    if (data.lastInvoiceDate !== undefined) result.lastInvoiceDate = data.lastInvoiceDate ? new Date(data.lastInvoiceDate) : null;
    if (data.prorationPolicy !== undefined) result.prorationPolicy = data.prorationPolicy;
    if (data.billingDescription !== undefined) result.billingDescription = data.billingDescription ?? null;
    return result;
  }

  private pricingSnapshot(data: Record<string, unknown>): Prisma.InputJsonObject {
    const json = (value: unknown): Prisma.InputJsonValue | null => {
      if (value == null) return null;
      if (value instanceof Date) return value.toISOString();
      if (value instanceof Prisma.Decimal) return value.toString();
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
      return String(value);
    };
    return {
      pricingType: json(data.pricingType),
      unitRate: json(data.unitRate),
      estimatedQuantity: json(data.estimatedQuantity),
      fixedAmount: json(data.fixedAmount),
      billingFrequency: json(data.billingFrequency),
      billingDay: json(data.billingDay),
      billingStartDate: json(data.billingStartDate),
      billingEndDate: json(data.billingEndDate),
      minimumBillableUnits: json(data.minimumBillableUnits),
      includedUnits: json(data.includedUnits),
      overtimeRate: json(data.overtimeRate),
      currency: json(data.currency),
      taxRate: json(data.taxRate),
      paymentTermsDays: json(data.paymentTermsDays),
      autoInvoiceEnabled: json(data.autoInvoiceEnabled),
      prorationPolicy: json(data.prorationPolicy),
      billingDescription: json(data.billingDescription),
    };
  }

  private contractPricingPlain(contract: Awaited<ReturnType<ContractService['getById']>>): Record<string, unknown> {
    const decimal = (value: unknown) => value instanceof Prisma.Decimal ? value.toNumber() : value;
    return {
      pricingType: contract.pricingType,
      unitRate: decimal(contract.unitRate),
      estimatedQuantity: decimal(contract.estimatedQuantity),
      fixedAmount: decimal(contract.fixedAmount),
      billingFrequency: contract.billingFrequency,
      billingDay: contract.billingDay,
      billingStartDate: contract.billingStartDate?.toISOString().slice(0, 10),
      billingEndDate: contract.billingEndDate?.toISOString().slice(0, 10),
      minimumBillableUnits: decimal(contract.minimumBillableUnits),
      includedUnits: decimal(contract.includedUnits),
      overtimeRate: decimal(contract.overtimeRate),
      currency: contract.currency,
      taxRate: decimal(contract.taxRate),
      paymentTermsDays: contract.paymentTermsDays,
      autoInvoiceEnabled: contract.autoInvoiceEnabled,
      prorationPolicy: contract.prorationPolicy,
      billingDescription: contract.billingDescription,
    };
  }

  private hash(value: string) {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  private hashBuffer(value: Buffer) {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  private assertCompanySignatureAssets(company: { signatureUrl?: string | null; stampUrl?: string | null }) {
    const signaturePath = resolveCompanyAssetUrl(company.signatureUrl);
    if (!signaturePath || !fs.existsSync(signaturePath)) {
      throw ApiError.badRequest('Company signature is required');
    }
    assertReadableImage(signaturePath, 'Company signature is invalid');

    const stampPath = resolveCompanyAssetUrl(company.stampUrl);
    if (!stampPath || !fs.existsSync(stampPath)) {
      throw ApiError.badRequest('Company stamp is required');
    }
    assertReadableImage(stampPath, 'Company stamp is invalid');
  }

  private async archiveSignedPdf(contractNumber: string, versionNumber: number, buffer: Buffer) {
    const directory = path.resolve(process.cwd(), env.UPLOADS_DIR, 'contracts', 'signed');
    await fs.promises.mkdir(directory, { recursive: true });
    const fileName = `${safeFileName(contractNumber)}-v${versionNumber}-${Date.now()}.pdf`;
    const absolutePath = path.join(directory, fileName);
    assertInside(absolutePath, directory);
    await fs.promises.writeFile(absolutePath, buffer, { flag: 'wx' });
    return `/uploads/contracts/signed/${fileName}`;
  }
}

function sanitizeText(value: string) {
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
}

function safeFileName(value: string) {
  return value.replace(/[^a-z0-9_.-]+/gi, '-').replace(/^-+|-+$/g, '') || 'contract';
}

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function assertReadableImage(imagePath: string, message: string) {
  const extension = path.extname(imagePath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg'].includes(extension)) {
    throw ApiError.badRequest(message);
  }

  try {
    fs.accessSync(imagePath, fs.constants.R_OK);
  } catch {
    throw ApiError.badRequest(message);
  }
}

function assertInside(targetPath: string, parentPath: string) {
  const relative = path.relative(parentPath, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw ApiError.badRequest('Invalid file path');
  }
}

export const contractService = new ContractService();
