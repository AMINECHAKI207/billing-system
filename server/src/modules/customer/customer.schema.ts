import { z } from 'zod';

/**
 * Customer Validation Schemas
 */

export const createCustomerSchema = z.object({
  body: z.object({
    name: z.string().min(2, 'Name must be at least 2 characters').max(255),
    email: z.string().email('Invalid email address'),
    phone: z.string().max(50).optional().nullable(),
    company: z.string().max(255).optional().nullable(),
    address: z.string().optional().nullable(),
    city: z.string().max(100).optional().nullable(),
    country: z
      .string({ required_error: "Please select the customer's country." })
      .min(1, "Please select the customer's country.")
      .max(100),
    countryCode: z
      .string({ required_error: "Please select the customer's country." })
      .min(2, "Please select the customer's country.")
      .max(2),
    postalCode: z.string().max(50).optional().nullable(),
    taxNumber: z.string().max(100).optional().nullable(),
  }),
});

export const updateCustomerSchema = z.object({
  body: z.object({
    name: z.string().min(2, 'Name must be at least 2 characters').max(255).optional(),
    email: z.string().email('Invalid email address').optional(),
    phone: z.string().max(50).optional().nullable(),
    company: z.string().max(255).optional().nullable(),
    address: z.string().optional().nullable(),
    city: z.string().max(100).optional().nullable(),
    country: z.string().min(1, "Please select the customer's country.").max(100).optional(),
    countryCode: z.string().min(2, "Please select the customer's country.").max(2).optional(),
    postalCode: z.string().max(50).optional().nullable(),
    taxNumber: z.string().max(100).optional().nullable(),
    isActive: z.boolean().optional(),
  }),
});

export const customerQuerySchema = z.object({
  query: z.object({
    page: z.string().regex(/^\d+$/).optional(),
    limit: z.string().regex(/^\d+$/).optional(),
    search: z.string().optional(),
    isActive: z.enum(['true', 'false']).optional().transform((value) => {
      if (value === undefined) return undefined;
      return value === 'true';
    }),
    sortBy: z.enum(['createdAt', 'name', 'company', 'email']).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
  }),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>['body'];
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>['body'];
export type CustomerQueryInput = z.infer<typeof customerQuerySchema>['query'];
