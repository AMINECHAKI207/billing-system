import { prisma } from '@config/database';
import { Prisma } from '@prisma/client';

export class CreditNoteRepository {
  async findInvoiceById(id: string, accessWhere: Prisma.InvoiceWhereInput = {}) {
    return prisma.invoice.findFirst({
      where: { id, AND: [accessWhere] },
      include: {
        customer: true,
        createdBy: { select: { id: true, name: true, email: true } },
        items: { orderBy: { sortOrder: 'asc' } },
        creditNotes: {
          where: { status: { in: ['VALIDATED', 'REFUNDED'] } },
          include: { lines: true },
        },
      },
    });
  }

  async findById(id: string, accessWhere: Prisma.CreditNoteWhereInput = {}) {
    return prisma.creditNote.findFirst({
      where: { id, AND: [accessWhere] },
      include: this.defaultInclude(),
    });
  }

  async findReasonById(id: string) {
    return prisma.creditNoteReason.findUnique({ where: { id } });
  }

  async findReasonByCode(code: string) {
    return prisma.creditNoteReason.findUnique({ where: { code } });
  }

  async findReasons(includeInactive = false) {
    return prisma.creditNoteReason.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { nameFr: 'asc' }],
      include: { _count: { select: { creditNotes: true } } },
    });
  }

  async createReason(data: Prisma.CreditNoteReasonUncheckedCreateInput) {
    return prisma.creditNoteReason.create({
      data,
      include: { _count: { select: { creditNotes: true } } },
    });
  }

  async updateReason(id: string, data: Prisma.CreditNoteReasonUncheckedUpdateInput) {
    return prisma.creditNoteReason.update({
      where: { id },
      data,
      include: { _count: { select: { creditNotes: true } } },
    });
  }

  async findAll(params: {
    skip: number;
    take: number;
    where: Prisma.CreditNoteWhereInput;
    orderBy: Prisma.CreditNoteOrderByWithRelationInput;
  }) {
    const [data, total] = await Promise.all([
      prisma.creditNote.findMany({
        where: params.where,
        skip: params.skip,
        take: params.take,
        orderBy: params.orderBy,
        include: {
          invoice: { select: { id: true, invoiceNumber: true, status: true, total: true, currency: true } },
          customer: { select: { id: true, name: true, email: true, company: true } },
          createdBy: { select: { id: true, name: true, email: true } },
          _count: { select: { lines: true } },
        },
      }),
      prisma.creditNote.count({ where: params.where }),
    ]);

    return { data, total };
  }

  async create(data: Prisma.CreditNoteUncheckedCreateInput) {
    return prisma.creditNote.create({
      data,
      include: this.defaultInclude(),
    });
  }

  async updateDraft(id: string, data: Prisma.CreditNoteUncheckedUpdateInput) {
    return prisma.$transaction(async (tx) => {
      await tx.creditNoteLine.deleteMany({ where: { creditNoteId: id } });
      return tx.creditNote.update({ where: { id }, data, include: this.defaultInclude() });
    });
  }

  async deleteDraft(id: string) {
    return prisma.creditNote.delete({ where: { id } });
  }

  async createEmailLog(data: Prisma.CreditNoteEmailLogUncheckedCreateInput) {
    return prisma.creditNoteEmailLog.create({ data });
  }

  include() {
    return this.defaultInclude();
  }

  private defaultInclude() {
    return {
      invoice: {
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          total: true,
          amountPaid: true,
          balanceDue: true,
          currency: true,
          issueDate: true,
          dueDate: true,
        },
      },
      reasonRef: true,
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
      createdBy: { select: { id: true, name: true, email: true } },
      validatedBy: { select: { id: true, name: true, email: true } },
      cancelledBy: { select: { id: true, name: true, email: true } },
      refundedBy: { select: { id: true, name: true, email: true } },
      lines: { orderBy: { sortOrder: 'asc' as const } },
      auditLogs: {
        orderBy: { createdAt: 'desc' as const },
        include: { actor: { select: { id: true, name: true, email: true } } },
      },
      emailLogs: {
        orderBy: { createdAt: 'desc' as const },
        include: { sentBy: { select: { id: true, name: true, email: true } } },
      },
    };
  }
}

export const creditNoteRepository = new CreditNoteRepository();
