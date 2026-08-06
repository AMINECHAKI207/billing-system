import { Request, Response, NextFunction } from 'express';
import { permissionScope } from '@modules/rbac/accessScope';
import { ApiResponse } from '@utils/ApiResponse';
import { creditNoteService } from './creditNote.service';
import {
  cancelCreditNoteSchema,
  createCreditNoteSchema,
  creditNoteReasonBodySchema,
  creditNoteReasonUpdateSchema,
  creditNoteQuerySchema,
  refundCreditNoteSchema,
  sendCreditNoteEmailSchema,
  updateCreditNoteSchema,
} from './creditNote.schema';

export class CreditNoteController {
  async getReasons(req: Request, res: Response, next: NextFunction) {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      const reasons = await creditNoteService.getReasons(includeInactive);
      ApiResponse.success(res, { reasons }, 'Credit note reasons retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async createReason(req: Request, res: Response, next: NextFunction) {
    try {
      const data = creditNoteReasonBodySchema.parse(req).body;
      const reason = await creditNoteService.createReason(req.user!.id, data);
      ApiResponse.created(res, { reason }, 'Credit note reason created successfully');
    } catch (error) {
      next(error);
    }
  }

  async updateReason(req: Request, res: Response, next: NextFunction) {
    try {
      const data = creditNoteReasonUpdateSchema.parse(req).body;
      const reason = await creditNoteService.updateReason(req.params.id!, data);
      ApiResponse.success(res, { reason }, 'Credit note reason updated successfully');
    } catch (error) {
      next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createCreditNoteSchema.parse(req).body;
      const creditNote = await creditNoteService.create(req.user!.id, permissionScope(req.user!.permissionScopes, 'credit_notes.create'), data);
      ApiResponse.created(res, { creditNote }, 'Credit note created successfully');
    } catch (error) {
      next(error);
    }
  }

  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const query = creditNoteQuerySchema.parse(req).query;
      const result = await creditNoteService.getAll(req.user!.id, permissionScope(req.user!.permissionScopes, 'credit_notes.view'), query);
      ApiResponse.success(res, result, 'Credit notes retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const creditNote = await creditNoteService.getById(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'credit_notes.view'));
      ApiResponse.success(res, { creditNote }, 'Credit note retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateCreditNoteSchema.parse(req).body;
      const creditNote = await creditNoteService.update(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'credit_notes.update'), data);
      ApiResponse.success(res, { creditNote }, 'Credit note updated successfully');
    } catch (error) {
      next(error);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await creditNoteService.remove(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'credit_notes.update'));
      ApiResponse.success(res, result, 'Credit note deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  async validate(req: Request, res: Response, next: NextFunction) {
    try {
      const creditNote = await creditNoteService.validate(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'credit_notes.validate'));
      ApiResponse.success(res, { creditNote }, 'Credit note validated successfully');
    } catch (error) {
      next(error);
    }
  }

  async cancel(req: Request, res: Response, next: NextFunction) {
    try {
      const data = cancelCreditNoteSchema.parse(req).body;
      const creditNote = await creditNoteService.cancel(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'credit_notes.cancel'), data);
      ApiResponse.success(res, { creditNote }, 'Credit note cancelled successfully');
    } catch (error) {
      next(error);
    }
  }

  async refund(req: Request, res: Response, next: NextFunction) {
    try {
      const data = refundCreditNoteSchema.parse(req).body;
      const creditNote = await creditNoteService.refund(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'credit_notes.refund'), data);
      ApiResponse.success(res, { creditNote }, 'Credit note refund recorded successfully');
    } catch (error) {
      next(error);
    }
  }

  async downloadPdf(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await creditNoteService.pdfBuffer(
        req.params.id!,
        req.user!.id,
        permissionScope(req.user!.permissionScopes, 'credit_notes.pdf.download'),
        typeof req.query.language === 'string' ? req.query.language : 'fr'
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
      res.setHeader('Content-Length', String(result.buffer.length));
      res.send(result.buffer);
    } catch (error) {
      next(error);
    }
  }

  async sendEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const data = sendCreditNoteEmailSchema.parse(req).body;
      const result = await creditNoteService.sendEmail(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'credit_notes.email.send'), data);
      ApiResponse.success(res, result, 'Credit note emailed successfully');
    } catch (error) {
      next(error);
    }
  }
}

export const creditNoteController = new CreditNoteController();
