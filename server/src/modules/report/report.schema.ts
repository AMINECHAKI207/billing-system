import { z } from 'zod';

const dateString = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Invalid date',
});

export const taxSummaryQuerySchema = z.object({
  query: z.object({
    dateFrom: dateString.optional(),
    dateTo: dateString.optional(),
  }),
});

export type TaxSummaryQueryInput = z.infer<typeof taxSummaryQuerySchema>['query'];
