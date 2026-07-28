import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '@utils/ApiResponse';
import { settingsService } from '@modules/settings/settings.service';
import { permissionScope } from '@modules/rbac/accessScope';
import { renderDevisPdf } from './devis.pdf';
import { devisService } from './devis.service';
import { createDevisSchema, devisQuerySchema, updateDevisSchema, updateDevisStatusSchema } from './devis.schema';

export class DevisController {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createDevisSchema.parse(req).body;
      const devis = await devisService.createDevis(req.user!, permissionScope(req.user!.permissionScopes, 'devis.create'), data);
      ApiResponse.created(res, { devis }, 'Quote created successfully');
    } catch (error) {
      next(error);
    }
  }

  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const query = devisQuerySchema.parse(req).query;
      const result = await devisService.getDevis(req.user!.id, permissionScope(req.user!.permissionScopes, 'devis.view'), query);
      ApiResponse.success(res, result, 'Quotes retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const devis = await devisService.getDevisById(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'devis.view'));
      ApiResponse.success(res, { devis }, 'Quote retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateDevisSchema.parse(req).body;
      const devis = await devisService.updateDevis(req.params.id!, req.user!, permissionScope(req.user!.permissionScopes, 'devis.update'), data);
      ApiResponse.success(res, { devis }, 'Quote updated successfully');
    } catch (error) {
      next(error);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await devisService.deleteDevis(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'devis.delete'));
      ApiResponse.success(res, {}, 'Quote deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  async removeDrafts(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await devisService.deleteDraftDevis(req.user!.id, permissionScope(req.user!.permissionScopes, 'devis.delete'));
      ApiResponse.success(res, result, 'Draft quotes deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { status } = updateDevisStatusSchema.parse(req).body;
      const devis = await devisService.updateStatus(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'devis.update'), status);
      ApiResponse.success(res, { devis }, 'Quote status updated successfully');
    } catch (error) {
      next(error);
    }
  }

  async send(req: Request, res: Response, next: NextFunction) {
    try {
      const devis = await devisService.updateStatus(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'devis.send'), 'SENT');
      ApiResponse.success(res, { devis }, 'Quote sent successfully');
    } catch (error) {
      next(error);
    }
  }

  async approve(req: Request, res: Response, next: NextFunction) {
    try {
      const devis = await devisService.updateStatus(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'devis.approve'), 'APPROVED');
      ApiResponse.success(res, { devis }, 'Quote approved successfully');
    } catch (error) {
      next(error);
    }
  }

  async reject(req: Request, res: Response, next: NextFunction) {
    try {
      const devis = await devisService.updateStatus(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'devis.reject'), 'REJECTED');
      ApiResponse.success(res, { devis }, 'Quote rejected successfully');
    } catch (error) {
      next(error);
    }
  }

  async convertToInvoice(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await devisService.convertToInvoice(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'devis.convert'));
      ApiResponse.created(res, result, 'Quote converted to invoice successfully');
    } catch (error) {
      next(error);
    }
  }

  async sign(req: Request, res: Response, next: NextFunction) {
    try {
      const devis = await devisService.signDevis(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'devis.sign'));
      ApiResponse.success(res, { devis }, 'Quote signed successfully');
    } catch (error) {
      next(error);
    }
  }

  async cancelSignature(req: Request, res: Response, next: NextFunction) {
    try {
      const devis = await devisService.cancelDevisSignature(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'devis.sign'));
      ApiResponse.success(res, { devis }, 'Quote signature cancelled successfully');
    } catch (error) {
      next(error);
    }
  }

  async downloadPdf(req: Request, res: Response, next: NextFunction) {
    try {
      const devis = await devisService.getDevisById(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'devis.download'));
      const company = await settingsService.getCompanySettings();
      const fileName = `${devis.devisNumber}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      renderDevisPdf(devis, company, res);
    } catch (error) {
      next(error);
    }
  }
}

export const devisController = new DevisController();
