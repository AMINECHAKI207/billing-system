import { prisma } from '@config/database';
import { Prisma } from '@prisma/client';

export class PaymentRepository {
  async findAll(params: {
    skip: number;
    take: number;
    where: Prisma.PaymentWhereInput;
  }) {
    const [data, total, aggregate] = await Promise.all([
      prisma.payment.findMany({
        where: params.where,
        skip: params.skip,
        take: params.take,
        orderBy: { paymentDate: 'desc' },
        include: this.defaultInclude(),
      }),
      prisma.payment.count({ where: params.where }),
      prisma.payment.aggregate({
        where: params.where,
        _sum: { amount: true },
      }),
    ]);

    return {
      data,
      total,
      totalAmount: Number(aggregate._sum.amount ?? 0),
    };
  }

  private defaultInclude() {
    return {
      invoice: {
        select: {
          id: true,
          invoiceNumber: true,
          currency: true,
          status: true,
          customer: {
            select: { id: true, name: true, company: true, email: true },
          },
        },
      },
      recordedBy: {
        select: { id: true, name: true, email: true },
      },
    };
  }
}

export const paymentRepository = new PaymentRepository();
