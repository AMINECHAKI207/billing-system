import { prisma } from '@config/database';
import { Prisma } from '@prisma/client';

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  themePreference: true,
  isActive: true,
  rbacRole: { select: { id: true, name: true } },
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      customers: true,
      invoices: true,
      payments: true,
      reminders: true,
    },
  },
} satisfies Prisma.UserSelect;

export class UserRepository {
  findById(id: string) {
    return prisma.user.findUnique({ where: { id }, select: userSelect });
  }

  findRawById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  }

  create(data: Prisma.UserCreateInput) {
    return prisma.user.create({ data, select: userSelect });
  }

  update(id: string, data: Prisma.UserUpdateInput) {
    return prisma.user.update({
      where: { id },
      data,
      select: userSelect,
    });
  }

  async findAll(params: {
    skip: number;
    take: number;
    where: Prisma.UserWhereInput;
    orderBy?: Prisma.UserOrderByWithRelationInput;
  }) {
    const [data, total] = await Promise.all([
      prisma.user.findMany({
        where: params.where,
        skip: params.skip,
        take: params.take,
        orderBy: params.orderBy ?? { createdAt: 'desc' },
        select: userSelect,
      }),
      prisma.user.count({ where: params.where }),
    ]);

    return { data, total };
  }
}

export const userRepository = new UserRepository();
