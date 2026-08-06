import { z } from 'zod';

export const auditListSchema = z.object({
  query: z.object({
    page: z.string().optional().default('1').transform(Number).pipe(z.number().int().min(1)),
    limit: z.string().optional().default('25').transform(Number).pipe(z.number().int().min(1).max(200)),
    search: z.string().trim().max(200).optional(),
    userId: z.string().uuid().optional(),
    module: z.string().trim().max(80).optional(),
    entity: z.string().trim().max(120).optional(),
    entityId: z.string().trim().max(120).optional(),
    action: z.string().trim().max(80).optional(),
    success: z.enum(['true', 'false']).optional(),
    startDate: z.string().datetime().or(z.string().date()).optional(),
    endDate: z.string().datetime().or(z.string().date()).optional(),
    sortBy: z.enum(['createdAt', 'module', 'entity', 'action', 'userId', 'success']).optional().default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  }),
});

export const auditTimelineSchema = z.object({
  params: z.object({
    entity: z.string().trim().min(1).max(120),
    entityId: z.string().trim().min(1).max(120),
  }),
  query: z.object({
    page: z.string().optional().default('1').transform(Number).pipe(z.number().int().min(1)),
    limit: z.string().optional().default('50').transform(Number).pipe(z.number().int().min(1).max(200)),
  }),
});

export const auditExportSchema = auditListSchema.extend({
  query: auditListSchema.shape.query.extend({
    format: z.enum(['csv', 'excel', 'pdf']).default('csv'),
  }),
});

export type AuditListQuery = z.infer<typeof auditListSchema>['query'];
export type AuditExportQuery = z.infer<typeof auditExportSchema>['query'];
