import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '@utils/ApiResponse';
import { createProductSchema, productQuerySchema, updateProductSchema } from './product.schema';
import { productService } from './product.service';

export class ProductController {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createProductSchema.parse(req).body;
      const product = await productService.createProduct(data);
      ApiResponse.created(res, { product }, 'Product created successfully');
    } catch (error) {
      next(error);
    }
  }

  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const query = productQuerySchema.parse(req).query;
      const result = await productService.getProducts(query);
      ApiResponse.success(res, result, 'Products retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateProductSchema.parse(req).body;
      const product = await productService.updateProduct(req.params.id!, data);
      ApiResponse.success(res, { product }, 'Product updated successfully');
    } catch (error) {
      next(error);
    }
  }
}

export const productController = new ProductController();
