import { z } from 'zod';
import { Role } from '@prisma/client';

/**
 * Authentication Validation Schemas
 *
 * Using Zod here ensures that any malformed requests are caught
 * before they even reach the controller logic. It also generates
 * TypeScript types automatically.
 */

export const registerSchema = z.object({
  body: z.object({
    name: z.string().min(2, 'Name must be at least 2 characters').max(255),
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    role: z.nativeEnum(Role).optional(),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
    rememberMe: z.boolean().optional().default(false),
  }),
});

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'New password must be at least 8 characters'),
  }),
});

export const updateThemeSchema = z.object({
  body: z.object({
    themePreference: z.enum(['light', 'dark']),
  }),
});

// Infer TypeScript types from the Zod schemas
export type RegisterInput = z.infer<typeof registerSchema>['body'];
export type LoginInput = z.infer<typeof loginSchema>['body'];
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>['body'];
export type UpdateThemeInput = z.infer<typeof updateThemeSchema>['body'];
