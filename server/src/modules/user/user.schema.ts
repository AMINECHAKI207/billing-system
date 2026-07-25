import { Role } from '@prisma/client';
import { z } from 'zod';

export const userQuerySchema = z.object({
  query: z.object({
    page: z.string().regex(/^\d+$/).optional(),
    limit: z.string().regex(/^\d+$/).optional(),
    search: z.string().optional(),
    role: z.nativeEnum(Role).optional(),
    isActive: z.enum(['true', 'false']).optional().transform((value) => {
      if (value === undefined) return undefined;
      return value === 'true';
    }),
  }),
});

export const createUserSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(255),
    email: z.string().email(),
    password: z.string().min(8),
    role: z.nativeEnum(Role).default(Role.EMPLOYEE),
    isActive: z.boolean().optional(),
  }),
});

export const updateUserSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(255).optional(),
    email: z.string().email().optional(),
    role: z.nativeEnum(Role).optional(),
    isActive: z.boolean().optional(),
    password: z.string().min(8).optional(),
  }),
});

export type UserQueryInput = z.infer<typeof userQuerySchema>['query'];
export type CreateUserInput = z.infer<typeof createUserSchema>['body'];
export type UpdateUserInput = z.infer<typeof updateUserSchema>['body'];
