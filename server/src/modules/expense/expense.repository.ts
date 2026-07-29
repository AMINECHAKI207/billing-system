import { prisma } from '@config/database';
import { Prisma } from '@prisma/client';

export const expenseNoteInclude = {
  category: true,
  expenseType: true,
  createdBy: { select: { id: true, name: true, email: true } },
  approvedBy: { select: { id: true, name: true, email: true } },
  rejectedBy: { select: { id: true, name: true, email: true } },
  changesRequestedBy: { select: { id: true, name: true, email: true } },
  paidBy: { select: { id: true, name: true, email: true } },
  attachments: true,
  aiAnalyses: {
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
  auditLogs: {
    orderBy: { createdAt: 'asc' },
    include: { actor: { select: { id: true, name: true, email: true } } },
  },
  emailLogs: {
    orderBy: { createdAt: 'desc' },
    include: { sentBy: { select: { id: true, name: true, email: true } } },
  },
} satisfies Prisma.ExpenseNoteInclude;

export class ExpenseRepository {
  createCategory(data: Prisma.ExpenseCategoryCreateInput) {
    return prisma.expenseCategory.create({ data });
  }

  updateCategory(id: string, data: Prisma.ExpenseCategoryUpdateInput) {
    return prisma.expenseCategory.update({ where: { id }, data });
  }

  findCategories(where: Prisma.ExpenseCategoryWhereInput = {}) {
    return prisma.expenseCategory.findMany({
      where,
      include: { expenseTypes: { orderBy: { name: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  }

  findCategoryById(id: string) {
    return prisma.expenseCategory.findUnique({ where: { id } });
  }

  createType(data: Prisma.ExpenseTypeCreateInput) {
    return prisma.expenseType.create({ data, include: { category: true } });
  }

  updateType(id: string, data: Prisma.ExpenseTypeUpdateInput) {
    return prisma.expenseType.update({ where: { id }, data, include: { category: true } });
  }

  findTypes(where: Prisma.ExpenseTypeWhereInput = {}) {
    return prisma.expenseType.findMany({
      where,
      include: { category: true },
      orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
    });
  }

  findTypeById(id: string) {
    return prisma.expenseType.findUnique({ where: { id }, include: { category: true } });
  }

  createNote(data: Prisma.ExpenseNoteCreateInput) {
    return prisma.expenseNote.create({ data, include: expenseNoteInclude });
  }

  updateNote(id: string, data: Prisma.ExpenseNoteUpdateInput) {
    return prisma.expenseNote.update({ where: { id }, data, include: expenseNoteInclude });
  }

  deleteNote(id: string) {
    return prisma.expenseNote.delete({ where: { id } });
  }

  findNoteById(id: string, where: Prisma.ExpenseNoteWhereInput = {}) {
    return prisma.expenseNote.findFirst({
      where: { id, ...where },
      include: expenseNoteInclude,
    });
  }

  async findNotes(params: {
    skip: number;
    take: number;
    where: Prisma.ExpenseNoteWhereInput;
  }) {
    const [data, total] = await Promise.all([
      prisma.expenseNote.findMany({
        where: params.where,
        skip: params.skip,
        take: params.take,
        include: expenseNoteInclude,
        orderBy: { expenseDate: 'desc' },
      }),
      prisma.expenseNote.count({ where: params.where }),
    ]);

    return { data, total };
  }

  createAttachment(data: Prisma.ExpenseAttachmentCreateInput) {
    return prisma.expenseAttachment.create({ data });
  }

  findAttachmentById(id: string) {
    return prisma.expenseAttachment.findUnique({ where: { id } });
  }

  updateAttachment(id: string, data: Prisma.ExpenseAttachmentUpdateInput) {
    return prisma.expenseAttachment.update({ where: { id }, data });
  }

  deleteAttachment(id: string) {
    return prisma.expenseAttachment.delete({ where: { id } });
  }

  createAIAnalysis(data: Prisma.ExpenseAIAnalysisCreateInput) {
    return prisma.expenseAIAnalysis.create({
      data,
      include: { attachment: true },
    });
  }

  findAIAnalysisById(id: string) {
    return prisma.expenseAIAnalysis.findUnique({ where: { id } });
  }

  updateAIAnalysis(id: string, data: Prisma.ExpenseAIAnalysisUpdateInput) {
    return prisma.expenseAIAnalysis.update({
      where: { id },
      data,
      include: { attachment: true },
    });
  }

  createAuditLog(data: Prisma.ExpenseAuditLogCreateInput) {
    return prisma.expenseAuditLog.create({ data });
  }

  createEmailLog(data: Prisma.ExpenseEmailLogUncheckedCreateInput) {
    return prisma.expenseEmailLog.create({
      data,
      include: { sentBy: { select: { id: true, name: true, email: true } } },
    });
  }

  findEmailLogById(id: string) {
    return prisma.expenseEmailLog.findUnique({
      where: { id },
      include: { expenseNote: { include: expenseNoteInclude }, sentBy: { select: { id: true, name: true, email: true } } },
    });
  }

  findEmailLogs(expenseNoteId: string) {
    return prisma.expenseEmailLog.findMany({
      where: { expenseNoteId },
      orderBy: { createdAt: 'desc' },
      include: { sentBy: { select: { id: true, name: true, email: true } } },
    });
  }
}

export const expenseRepository = new ExpenseRepository();
