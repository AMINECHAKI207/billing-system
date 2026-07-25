import { PaymentMethod, PermissionScope, Prisma } from '@prisma/client';
import { parsePagination } from '@utils/pagination';
import { PaymentQueryInput } from './payment.schema';
import { paymentRepository } from './payment.repository';
import { paymentAccessWhere } from '@modules/rbac/accessScope';

export class PaymentService {
  async getPayments(userId: string, scope: PermissionScope, query: PaymentQueryInput) {
    const { skip, limit, page } = parsePagination({ page: query.page, limit: query.limit });
    const where: Prisma.PaymentWhereInput = {
      AND: [paymentAccessWhere(userId, scope)],
      ...(query.method && { method: query.method as PaymentMethod }),
      ...((query.dateFrom || query.dateTo) && {
        paymentDate: {
          ...(query.dateFrom && { gte: new Date(query.dateFrom) }),
          ...(query.dateTo && { lte: new Date(query.dateTo) }),
        },
      }),
      ...(query.search && {
        OR: [
          { reference: { contains: query.search, mode: 'insensitive' } },
          { notes: { contains: query.search, mode: 'insensitive' } },
          { invoice: { invoiceNumber: { contains: query.search, mode: 'insensitive' } } },
          { invoice: { customer: { name: { contains: query.search, mode: 'insensitive' } } } },
          { invoice: { customer: { company: { contains: query.search, mode: 'insensitive' } } } },
        ],
      }),
    };

    const { data, total, totalAmount } = await paymentRepository.findAll({
      skip,
      take: limit,
      where,
    });

    return {
      data,
      summary: { totalAmount },
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

export const paymentService = new PaymentService();
