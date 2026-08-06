import { prisma } from '@config/database';
import { ContractStatus, Prisma } from '@prisma/client';

export class ContractRepository {
  include() {
    return {
      client: { select: { id: true, name: true, email: true, company: true, country: true, countryCode: true, address: true, city: true, taxNumber: true } },
      createdBy: { select: { id: true, name: true, email: true } },
      sentBy: { select: { id: true, name: true, email: true } },
      companySignedBy: { select: { id: true, name: true, email: true } },
      currentVersion: true,
      signedVersion: true,
      versions: { orderBy: { versionNumber: 'desc' as const }, take: 10 },
      invoices: {
        orderBy: { issueDate: 'desc' as const },
        take: 20,
        select: { id: true, invoiceNumber: true, total: true, status: true, issueDate: true, billingPeriodStart: true, billingPeriodEnd: true },
      },
      timeEntries: {
        orderBy: { workDate: 'desc' as const },
        take: 50,
        include: { user: { select: { id: true, name: true, email: true } } },
      },
      milestones: { orderBy: [{ sortOrder: 'asc' as const }, { dueDate: 'asc' as const }], take: 50 },
      billingScheduleItems: { orderBy: [{ sortOrder: 'asc' as const }, { dueDate: 'asc' as const }], take: 50 },
      signatureLinks: { orderBy: { createdAt: 'desc' as const }, take: 5 },
      auditLogs: {
        orderBy: { createdAt: 'desc' as const },
        take: 25,
        include: { actor: { select: { id: true, name: true, email: true } } },
      },
      emailLogs: { orderBy: { createdAt: 'desc' as const }, take: 10 },
    } satisfies Prisma.ContractInclude;
  }

  findClientById(id: string, accessWhere: Prisma.CustomerWhereInput = {}) {
    return prisma.customer.findFirst({ where: { id, AND: [accessWhere] } });
  }

  findTemplateById(id: string) {
    return prisma.contractTemplate.findFirst({ where: { id, isActive: true } });
  }

  findTemplates(includeInactive = false) {
    return prisma.contractTemplate.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { nameFr: 'asc' }],
    });
  }

  async findAll(params: {
    where: Prisma.ContractWhereInput;
    skip: number;
    take: number;
    orderBy: Prisma.ContractOrderByWithRelationInput;
  }) {
    const [data, total] = await Promise.all([
      prisma.contract.findMany({
        where: params.where,
        skip: params.skip,
        take: params.take,
        orderBy: params.orderBy,
        include: {
          client: { select: { id: true, name: true, email: true, company: true } },
          createdBy: { select: { id: true, name: true, email: true } },
          currentVersion: { select: { id: true, versionNumber: true, isSigned: true } },
          _count: { select: { versions: true, emailLogs: true, invoices: true, timeEntries: true, milestones: true } },
        },
      }),
      prisma.contract.count({ where: params.where }),
    ]);
    return { data, total };
  }

  findById(id: string, accessWhere: Prisma.ContractWhereInput = {}) {
    return prisma.contract.findFirst({
      where: { id, AND: [accessWhere] },
      include: this.include(),
    });
  }

  markExpired(now = new Date()) {
    return prisma.contract.updateMany({
      where: { endDate: { lt: now }, status: { in: [ContractStatus.SENT, ContractStatus.VIEWED, ContractStatus.ACTIVE] } },
      data: { status: ContractStatus.EXPIRED, expiredAt: now },
    });
  }
}

export const contractRepository = new ContractRepository();
