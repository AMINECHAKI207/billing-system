import { ApiError } from '@utils/ApiError';
import { parsePagination } from '@utils/pagination';
import { Prisma } from '@prisma/client';
import { CreateProductInput, ProductQueryInput, UpdateProductInput } from './product.schema';
import { productRepository } from './product.repository';

export class ProductService {
  async createProduct(data: CreateProductInput) {
    return productRepository.create(data);
  }

  async updateProduct(id: string, data: UpdateProductInput) {
    const product = await productRepository.findById(id);
    if (!product) {
      throw ApiError.notFound('Product');
    }

    return productRepository.update(id, data);
  }

  async getProducts(query: ProductQueryInput) {
    const { skip, limit, page } = parsePagination({ page: query.page, limit: query.limit });
    const where: Prisma.ProductWhereInput = {
      ...(query.isActive !== undefined && { isActive: query.isActive }),
      ...(query.search && {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };
    const { data, total } = await productRepository.findAll({ skip, take: limit, where });

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

export const productService = new ProductService();
