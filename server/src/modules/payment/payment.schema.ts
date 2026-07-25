import { PaymentMethod } from '@prisma/client';
import { z } from 'zod';

const dateString = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Invalid date',
});

export const paymentQuerySchema = z.object({
  query: z.object({
    page: z.string().regex(/^\d+$/).optional(),
    limit: z.string().regex(/^\d+$/).optional(),
    search: z.string().optional(),
    method: z.nativeEnum(PaymentMethod).optional(),
    dateFrom: dateString.optional(),
    dateTo: dateString.optional(),
  }),
});

export type PaymentQueryInput = z.infer<typeof paymentQuerySchema>['query'];
