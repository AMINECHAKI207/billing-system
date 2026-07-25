import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '@utils/ApiResponse';
import { paymentQuerySchema } from './payment.schema';
import { paymentService } from './payment.service';
import { permissionScope } from '@modules/rbac/accessScope';

export class PaymentController {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const query = paymentQuerySchema.parse(req).query;
      const result = await paymentService.getPayments(req.user!.id, permissionScope(req.user!.permissionScopes, 'payments.view'), query);
      ApiResponse.success(res, result, 'Payments retrieved successfully');
    } catch (error) {
      next(error);
    }
  }
}

export const paymentController = new PaymentController();
