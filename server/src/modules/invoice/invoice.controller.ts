import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '@utils/ApiResponse';
import { invoiceService } from './invoice.service';
import { settingsService } from '@modules/settings/settings.service';
import { renderInvoicePdf } from './invoice.pdf';
import { permissionScope } from '@modules/rbac/accessScope';
import {
  addPaymentSchema,
  createInvoiceSchema,
  dashboardQuerySchema,
  invoiceQuerySchema,
  sendInvoiceEmailSchema,
  updateInvoiceSchema,
  updateInvoiceStatusSchema,
} from './invoice.schema';

export class InvoiceController {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createInvoiceSchema.parse(req).body;
      const invoice = await invoiceService.createInvoice(req.user!, permissionScope(req.user!.permissionScopes, 'invoices.create'), data);

      ApiResponse.created(res, { invoice }, 'Invoice created successfully');
    } catch (error) {
      next(error);
    }
  }

  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const query = invoiceQuerySchema.parse(req).query;
      const result = await invoiceService.getInvoices(req.user!.id, permissionScope(req.user!.permissionScopes, 'invoices.view'), query);

      ApiResponse.success(res, result, 'Invoices retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async getDashboard(req: Request, res: Response, next: NextFunction) {
    try {
      const query = dashboardQuerySchema.parse(req).query;
      const dashboard = await invoiceService.getDashboardStats(req.user!.id, permissionScope(req.user!.permissionScopes, 'invoices.view'), query);

      ApiResponse.success(res, { dashboard }, 'Invoice dashboard retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async exportExcel(req: Request, res: Response, next: NextFunction) {
    try {
      const query = invoiceQuerySchema.parse(req).query;
      const buffer = await invoiceService.exportInvoicesExcel(
        req.user!.id,
        permissionScope(req.user!.permissionScopes, 'invoices.view'),
        query
      );
      const fileName = `invoices-${new Date().toISOString().slice(0, 10)}.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Length', String(buffer.length));
      res.send(buffer);
    } catch (error) {
      next(error);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const invoice = await invoiceService.getInvoiceById(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'invoices.view'));

      ApiResponse.success(res, { invoice }, 'Invoice retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateInvoiceSchema.parse(req).body;
      const invoice = await invoiceService.updateInvoice(req.params.id!, req.user!, permissionScope(req.user!.permissionScopes, 'invoices.update'), data);

      ApiResponse.success(res, { invoice }, 'Invoice updated successfully');
    } catch (error) {
      next(error);
    }
  }

  async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { status } = updateInvoiceStatusSchema.parse(req).body;
      const invoice = await invoiceService.updateStatus(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'invoices.update'), status);

      ApiResponse.success(res, { invoice }, 'Invoice status updated successfully');
    } catch (error) {
      next(error);
    }
  }

  async addPayment(req: Request, res: Response, next: NextFunction) {
    try {
      const data = addPaymentSchema.parse(req).body;
      const result = await invoiceService.addPayment(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'payments.create'), data);

      ApiResponse.created(res, result, 'Payment recorded successfully');
    } catch (error) {
      next(error);
    }
  }

  async downloadPdf(req: Request, res: Response, next: NextFunction) {
    try {
      const invoice = await invoiceService.getInvoiceById(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'invoices.view'));
      const company = await settingsService.getCompanySettings();
      const fileName = `${invoice.invoiceNumber}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

      renderInvoicePdf(invoice, company, res);
    } catch (error) {
      next(error);
    }
  }

  async sign(req: Request, res: Response, next: NextFunction) {
    try {
      const invoice = await invoiceService.signInvoice(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'invoices.sign'));
      ApiResponse.success(res, { invoice }, 'Invoice signed successfully');
    } catch (error) {
      next(error);
    }
  }

  async cancelSignature(req: Request, res: Response, next: NextFunction) {
    try {
      const invoice = await invoiceService.cancelInvoiceSignature(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'invoices.sign'));
      ApiResponse.success(res, { invoice }, 'Invoice signature cancelled successfully');
    } catch (error) {
      next(error);
    }
  }

  async sendEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const data = sendInvoiceEmailSchema.parse(req).body;
      const result = await invoiceService.sendInvoiceEmail(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'invoices.send'), data);

      ApiResponse.success(res, result, 'Invoice emailed successfully');
    } catch (error) {
      next(error);
    }
  }
}

export const invoiceController = new InvoiceController();
