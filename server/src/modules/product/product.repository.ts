import { prisma } from '@config/database';
import { Prisma } from '@prisma/client';

export class ProductRepository {
  async create(data: Prisma.ProductCreateInput) {
    return prisma.product.create({ data });
  }

  async findById(id: string) {
    return prisma.product.findUnique({ where: { id } });
  }

  async update(id: string, data: Prisma.ProductUpdateInput) {
    return prisma.product.update({ where: { id }, data });
  }

  async findAll(params: {
    skip: number;
    take: number;
    where: Prisma.ProductWhereInput;
  }) {
    const [data, total] = await Promise.all([
      prisma.product.findMany({
        where: params.where,
        skip: params.skip,
        take: params.take,
        orderBy: { name: 'asc' },
      }),
      prisma.product.count({ where: params.where }),
    ]);

    return { data, total };
  }
}

export const productRepository = new ProductRepository();
