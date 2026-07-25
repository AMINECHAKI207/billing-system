import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '@utils/ApiResponse';
import { ApiError } from '@utils/ApiError';
import { reportService } from './report.service';
import { taxSummaryQuerySchema } from './report.schema';

export class ReportController {
  async receivablesAging(_req: Request, res: Response, next: NextFunction) {
    try {
      const report = await reportService.getReceivablesAging();
      ApiResponse.success(res, { report }, 'Receivables aging report retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async taxSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const query = taxSummaryQuerySchema.parse(req).query;
      const report = await reportService.getTaxSummary(query);
      ApiResponse.success(res, { report }, 'Tax summary report retrieved successfully');
    } catch (error) {
      if (error instanceof Error && error.message === 'dateFrom must be before dateTo') {
        next(ApiError.badRequest(error.message));
        return;
      }
      next(error);
    }
  }
}

export const reportController = new ReportController();
