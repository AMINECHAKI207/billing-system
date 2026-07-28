import { prisma } from '@config/database';
import { DevisStatus, InvoiceStatus, Prisma } from '@prisma/client';

export class DevisRepository {
  async findCustomerById(id: string, accessWhere: Prisma.CustomerWhereInput = {}) {
    return prisma.customer.findFirst({ where: { id, AND: [accessWhere] } });
  }

  async create(data: Prisma.DevisUncheckedCreateInput) {
    return prisma.devis.create({
      data,
      include: this.defaultInclude(),
    });
  }

  async findById(id: string, accessWhere: Prisma.DevisWhereInput = {}) {
    return prisma.devis.findFirst({
      where: { id, AND: [accessWhere] },
      include: this.defaultInclude(),
    });
  }

  async findApprovedByCustomer(customerId: string, excludeId?: string) {
    return prisma.devis.findMany({
      where: {
        customerId,
        status: DevisStatus.APPROVED,
        ...(excludeId && { id: { not: excludeId } }),
      },
      include: {
        items: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
  }

  async findAll(params: {
    skip: number;
    take: number;
    where: Prisma.DevisWhereInput;
    orderBy: Prisma.DevisOrderByWithRelationInput;
  }) {
    const [data, total] = await Promise.all([
      prisma.devis.findMany({
        where: params.where,
        skip: params.skip,
        take: params.take,
        orderBy: params.orderBy,
        include: {
          customer: {
            select: { id: true, name: true, email: true, company: true, country: true, countryCode: true },
          },
          createdBy: {
            select: { id: true, name: true, email: true },
          },
          generatedInvoice: {
            select: { id: true, invoiceNumber: true, status: true },
          },
          _count: {
            select: { items: true },
          },
        },
      }),
      prisma.devis.count({ where: params.where }),
    ]);

    return { data, total };
  }

  async updateDraftDevis(id: string, data: Prisma.DevisUncheckedUpdateInput) {
    return prisma.$transaction(async (tx) => {
      await tx.devisItem.deleteMany({ where: { devisId: id } });

      return tx.devis.update({
        where: { id },
        data,
        include: this.defaultInclude(),
      });
    });
  }

  async updateStatus(id: string, status: DevisStatus) {
    return prisma.devis.update({
      where: { id },
      data: {
        status,
        sentAt: status === DevisStatus.SENT ? new Date() : undefined,
        approvedAt: status === DevisStatus.APPROVED ? new Date() : undefined,
        rejectedAt: status === DevisStatus.REJECTED ? new Date() : undefined,
      },
      include: this.defaultInclude(),
    });
  }

  async deleteDraft(id: string) {
    return prisma.devis.delete({ where: { id } });
  }

  async deleteDrafts(where: Prisma.DevisWhereInput) {
    return prisma.devis.deleteMany({
      where: {
        AND: [
          where,
          {
            status: DevisStatus.DRAFT,
            isSigned: false,
            generatedInvoice: null,
          },
        ],
      },
    });
  }

  async signDevis(params: {
    devisId: string;
    signedById: string;
    signatureUrl: string;
    stampUrl: string;
  }) {
    return prisma.$transaction(async (tx) => {
      const devis = await tx.devis.findUnique({
        where: { id: params.devisId },
        select: { id: true, isSigned: true },
      });

      if (!devis) return null;
      if (devis.isSigned) return 'ALREADY_SIGNED' as const;

      return tx.devis.update({
        where: { id: params.devisId },
        data: {
          isSigned: true,
          signedAt: new Date(),
          signedById: params.signedById,
          signatureUrl: params.signatureUrl,
          stampUrl: params.stampUrl,
        },
        include: this.defaultInclude(),
      });
    });
  }

  async cancelDevisSignature(devisId: string) {
    return prisma.$transaction(async (tx) => {
      const devis = await tx.devis.findUnique({
        where: { id: devisId },
        select: { id: true, isSigned: true },
      });

      if (!devis) return null;
      if (!devis.isSigned) return 'NOT_SIGNED' as const;

      return tx.devis.update({
        where: { id: devisId },
        data: {
          isSigned: false,
          signedAt: null,
          signedById: null,
          signatureUrl: null,
          stampUrl: null,
        },
        include: this.defaultInclude(),
      });
    });
  }

  async markExpiredDevis(now = new Date()) {
    return prisma.devis.updateMany({
      where: {
        validUntil: { lt: now },
        status: { in: [DevisStatus.SENT] },
      },
      data: { status: DevisStatus.EXPIRED },
    });
  }

  async convertToInvoice(devisId: string, dueDate: Date) {
    return prisma.$transaction(async (tx) => {
      const devis = await tx.devis.findUnique({
        where: { id: devisId },
        include: {
          items: { orderBy: { sortOrder: 'asc' } },
        },
      });

      if (!devis) return null;
      const existingInvoice = await tx.invoice.findUnique({
        where: { sourceDevisId: devisId },
        include: this.invoiceInclude(),
      });
      if (existingInvoice) return 'ALREADY_CONVERTED' as const;
      if (devis.status !== DevisStatus.APPROVED) return 'INVALID_STATUS' as const;

      const year = new Date().getFullYear();
      const sequence = await tx.invoiceSequence.upsert({
        where: { year },
        create: { year, nextNumber: 2 },
        update: { nextNumber: { increment: 1 } },
      });
      const invoiceNumber = `INV-${year}-${String(sequence.nextNumber - 1).padStart(4, '0')}`;

      const invoice = await tx.invoice.create({
        data: {
          customerId: devis.customerId,
          createdById: devis.createdById,
          invoiceNumber,
          status: InvoiceStatus.DRAFT,
          issueDate: new Date(),
          dueDate,
          subtotal: devis.subtotal,
          taxRate: devis.taxRate,
          taxAmount: devis.taxAmount,
          customerCountry: devis.customerCountry,
          customerCountryCode: devis.customerCountryCode,
          vatOverridden: devis.vatOverridden,
          vatOverrideReason: devis.vatOverrideReason,
          vatOverriddenAt: devis.vatOverriddenAt,
          vatOverriddenById: devis.vatOverriddenById,
          discount: devis.discount,
          total: devis.total,
          amountPaid: 0,
          balanceDue: devis.total,
          notes: devis.notes,
          terms: devis.terms,
          currency: devis.currency,
          isSigned: devis.isSigned,
          signedAt: devis.signedAt,
          signedById: devis.signedById,
          signatureUrl: devis.signatureUrl,
          stampUrl: devis.stampUrl,
          sourceDevisId: devis.id,
          items: {
            create: devis.items.map((item, index) => ({
              description: item.description,
              unit: item.unit,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              taxRate: item.taxRate,
              total: item.lineTotal,
              sortOrder: index + 1,
            })),
          },
        },
        include: this.invoiceInclude(),
      });

      const updatedDevis = await tx.devis.update({
        where: { id: devisId },
        data: {
          status: DevisStatus.CONVERTED,
          convertedAt: new Date(),
        },
        include: this.defaultInclude(),
      });

      return { devis: updatedDevis, invoice };
    });
  }

  private defaultInclude() {
    return {
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
      createdBy: {
        select: { id: true, name: true, email: true },
      },
      signedBy: {
        select: { id: true, name: true, email: true },
      },
      vatOverriddenBy: {
        select: { id: true, name: true, email: true },
      },
      items: {
        orderBy: { sortOrder: 'asc' as const },
      },
      generatedInvoice: {
        select: { id: true, invoiceNumber: true, status: true, total: true, currency: true },
      },
    };
  }

  private invoiceInclude() {
    return {
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
      createdBy: {
        select: { id: true, name: true, email: true },
      },
      items: {
        orderBy: { sortOrder: 'asc' as const },
      },
      sourceDevis: {
        select: { id: true, devisNumber: true, status: true },
      },
    };
  }
}

export const devisRepository = new DevisRepository();
