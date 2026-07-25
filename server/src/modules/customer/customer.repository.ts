import { prisma } from '@config/database';
import { Customer, InvoiceStatus, Prisma } from '@prisma/client';

export class CustomerRepository {
  /**
   * Create a new customer
   */
  async create(data: Prisma.CustomerUncheckedCreateInput): Promise<Customer> {
    return prisma.customer.create({ data });
  }

  /**
   * Find a customer by ID
   */
  async findById(id: string, accessWhere: Prisma.CustomerWhereInput = {}): Promise<Customer | null> {
    return prisma.customer.findFirst({
      where: { id, AND: [accessWhere] },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: { invoices: true },
        },
      },
    });
  }

  async getFinancialSummary(id: string) {
    const [totals, overdueInvoices] = await Promise.all([
      prisma.invoice.aggregate({
        where: { customerId: id },
        _sum: {
          total: true,
          amountPaid: true,
          balanceDue: true,
        },
        _count: {
          _all: true,
        },
      }),
      prisma.invoice.count({
        where: {
          customerId: id,
          balanceDue: { gt: 0 },
          status: { notIn: [InvoiceStatus.PAID, InvoiceStatus.CANCELLED] },
          dueDate: { lt: new Date() },
        },
      }),
    ]);

    return {
      totalInvoices: totals._count._all,
      totalInvoiced: Number(totals._sum.total ?? 0),
      totalPaid: Number(totals._sum.amountPaid ?? 0),
      totalUnpaid: Number(totals._sum.balanceDue ?? 0),
      overdueInvoices,
    };
  }

  /**
   * Find a customer by email
   */
  async findByEmail(email: string): Promise<Customer | null> {
    return prisma.customer.findFirst({
      where: { email },
    });
  }

  /**
   * Update a customer
   */
  async update(id: string, data: Prisma.CustomerUpdateInput): Promise<Customer> {
    return prisma.customer.update({
      where: { id },
      data,
    });
  }

  /**
   * Delete (or soft delete) a customer
   */
  async delete(id: string): Promise<Customer> {
    return prisma.customer.delete({
      where: { id },
    });
  }

  /**
   * Get all customers with pagination and optional search
   */
  async findAll(params: {
    skip?: number;
    take?: number;
    search?: string;
    isActive?: boolean;
    orderBy?: Prisma.CustomerOrderByWithRelationInput;
    accessWhere?: Prisma.CustomerWhereInput;
  }): Promise<{ data: Customer[]; total: number }> {
    const { skip = 0, take = 10, search, isActive, orderBy = { createdAt: 'desc' }, accessWhere = {} } = params;

    const where: Prisma.CustomerWhereInput = {
      AND: [accessWhere],
      ...(isActive !== undefined && { isActive }),
      ...(search && {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { company: { contains: search, mode: 'insensitive' } },
          ],
        }),
    };

    const [data, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          _count: {
            select: { invoices: true },
          },
        },
      }),
      prisma.customer.count({ where }),
    ]);

    return { data, total };
  }
}

export const customerRepository = new CustomerRepository();
