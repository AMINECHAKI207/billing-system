import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '@utils/ApiResponse';
import { auditExportSchema, auditListSchema, auditTimelineSchema } from './audit.schema';
import { auditService } from './audit.service';

export const auditController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = auditListSchema.parse(req).query;
      const result = await auditService.list(query);
      ApiResponse.success(res, { auditLogs: result.data }, 'Audit logs retrieved', 200, result.meta);
    } catch (error) {
      next(error);
    }
  },

  async timeline(req: Request, res: Response, next: NextFunction) {
    try {
      const input = auditTimelineSchema.parse(req);
      const result = await auditService.timeline(input.params.entity, input.params.entityId, input.query.page, input.query.limit);
      ApiResponse.success(res, { auditLogs: result.data }, 'Entity timeline retrieved', 200, result.meta);
    } catch (error) {
      next(error);
    }
  },

  async export(req: Request, res: Response, next: NextFunction) {
    try {
      const query = auditExportSchema.parse(req).query;
      const result = await auditService.export(query);
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
      res.send(result.buffer);
    } catch (error) {
      next(error);
    }
  },
};
