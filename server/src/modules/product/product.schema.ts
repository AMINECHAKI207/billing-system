import { z } from 'zod';

const productBody = z.object({
  name: z.string().min(2).max(255),
  description: z.string().optional().nullable(),
  unit: z.string().max(50).optional().nullable(),
  unitPrice: z.coerce.number().min(0),
  taxRate: z.coerce.number().min(0).max(100).default(20),
  isActive: z.boolean().optional(),
});

export const createProductSchema = z.object({ body: productBody });
export const updateProductSchema = z.object({ body: productBody.partial() });

export const productQuerySchema = z.object({
  query: z.object({
    page: z.string().regex(/^\d+$/).optional(),
    limit: z.string().regex(/^\d+$/).optional(),
    search: z.string().optional(),
    isActive: z.enum(['true', 'false']).optional().transform((value) => {
      if (value === undefined) return undefined;
      return value === 'true';
    }),
  }),
});

export type CreateProductInput = z.infer<typeof createProductSchema>['body'];
export type UpdateProductInput = z.infer<typeof updateProductSchema>['body'];
export type ProductQueryInput = z.infer<typeof productQuerySchema>['query'];
