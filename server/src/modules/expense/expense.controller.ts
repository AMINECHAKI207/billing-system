import { NextFunction, Request, Response } from 'express';
import path from 'path';
import { ApiResponse } from '@utils/ApiResponse';
import {
  categoryQuerySchema,
  createExpenseCategorySchema,
  createExpenseNoteSchema,
  createExpenseTypeSchema,
  expenseAttachmentParamSchema,
  expenseBulkExportSchema,
  expenseEmailLogParamSchema,
  expenseIdParamSchema,
  expenseNoteQuerySchema,
  expensePdfQuerySchema,
  expenseReasonSchema,
  sendExpenseEmailSchema,
  typeQuerySchema,
  updateExpenseCategorySchema,
  updateExpenseNoteSchema,
  updateExpenseTypeSchema,
} from './expense.schema';
import { expenseService } from './expense.service';

export class ExpenseController {
  async listCategories(req: Request, res: Response, next: NextFunction) {
    try {
      const query = categoryQuerySchema.parse(req).query;
      const categories = await expenseService.listCategories(query);
      ApiResponse.success(res, { categories }, 'Expense categories retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async createCategory(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createExpenseCategorySchema.parse(req).body;
      const category = await expenseService.createCategory(data);
      ApiResponse.created(res, { category }, 'Expense category created successfully');
    } catch (error) {
      next(error);
    }
  }

  async updateCategory(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = expenseIdParamSchema.parse(req).params;
      const data = updateExpenseCategorySchema.parse(req).body;
      const category = await expenseService.updateCategory(id, data);
      ApiResponse.success(res, { category }, 'Expense category updated successfully');
    } catch (error) {
      next(error);
    }
  }

  async listTypes(req: Request, res: Response, next: NextFunction) {
    try {
      const query = typeQuerySchema.parse(req).query;
      const types = await expenseService.listTypes(query);
      ApiResponse.success(res, { types }, 'Expense types retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async createType(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createExpenseTypeSchema.parse(req).body;
      const type = await expenseService.createType(data);
      ApiResponse.created(res, { type }, 'Expense type created successfully');
    } catch (error) {
      next(error);
    }
  }

  async updateType(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = expenseIdParamSchema.parse(req).params;
      const data = updateExpenseTypeSchema.parse(req).body;
      const type = await expenseService.updateType(id, data);
      ApiResponse.success(res, { type }, 'Expense type updated successfully');
    } catch (error) {
      next(error);
    }
  }

  async listNotes(req: Request, res: Response, next: NextFunction) {
    try {
      const query = expenseNoteQuerySchema.parse(req).query;
      const result = await expenseService.listNotes(req.user!, query);
      ApiResponse.success(res, result, 'Expense notes retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async analytics(req: Request, res: Response, next: NextFunction) {
    try {
      const query = expenseNoteQuerySchema.parse(req).query;
      const analytics = await expenseService.getAnalytics(req.user!, query);
      ApiResponse.success(res, { analytics }, 'Expense analytics retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async getNote(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = expenseIdParamSchema.parse(req).params;
      const expenseNote = await expenseService.getNote(req.user!, id);
      ApiResponse.success(res, { expenseNote }, 'Expense note retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async previewPdf(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = expenseIdParamSchema.parse(req).params;
      const query = expensePdfQuerySchema.parse(req).query;
      const result = await expenseService.renderNotePdf(req.user!, id, 'expense_notes.pdf.preview', 'PDF_PREVIEWED', query.language);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${result.fileName}"`);
      res.setHeader('Content-Length', String(result.buffer.length));
      res.send(result.buffer);
    } catch (error) {
      next(error);
    }
  }

  async downloadPdf(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = expenseIdParamSchema.parse(req).params;
      const query = expensePdfQuerySchema.parse(req).query;
      const action = query.disposition === 'inline' ? 'PDF_PRINTED' : 'PDF_DOWNLOADED';
      const permission = query.disposition === 'inline' ? 'expense_notes.pdf.print' : 'expense_notes.pdf.download';
      const result = await expenseService.renderNotePdf(req.user!, id, permission, action, query.language);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `${query.disposition}; filename="${result.fileName}"`);
      res.setHeader('Content-Length', String(result.buffer.length));
      res.send(result.buffer);
    } catch (error) {
      next(error);
    }
  }

  async sendEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = expenseIdParamSchema.parse(req).params;
      const data = sendExpenseEmailSchema.parse(req).body;
      const result = await expenseService.sendNoteEmail(req.user!, id, data);
      ApiResponse.success(res, result, 'Expense note emailed successfully');
    } catch (error) {
      next(error);
    }
  }

  async emailHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = expenseIdParamSchema.parse(req).params;
      const emailLogs = await expenseService.getEmailHistory(req.user!, id);
      ApiResponse.success(res, { emailLogs }, 'Expense note email history retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async resendEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const { emailLogId } = expenseEmailLogParamSchema.parse(req).params;
      const result = await expenseService.resendEmail(req.user!, emailLogId);
      ApiResponse.success(res, result, 'Expense note email resent successfully');
    } catch (error) {
      next(error);
    }
  }

  async exportNotes(req: Request, res: Response, next: NextFunction) {
    try {
      const data = expenseBulkExportSchema.parse(req).body;
      const result = await expenseService.exportNotes(req.user!, data);
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
      res.setHeader('Content-Length', String(result.buffer.length));
      res.send(result.buffer);
    } catch (error) {
      next(error);
    }
  }

  async createNote(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createExpenseNoteSchema.parse(req).body;
      const expenseNote = await expenseService.createNote(req.user!, data);
      ApiResponse.created(res, { expenseNote }, 'Expense note created successfully');
    } catch (error) {
      next(error);
    }
  }

  async updateNote(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = expenseIdParamSchema.parse(req).params;
      const data = updateExpenseNoteSchema.parse(req).body;
      const expenseNote = await expenseService.updateNote(req.user!, id, data);
      ApiResponse.success(res, { expenseNote }, 'Expense note updated successfully');
    } catch (error) {
      next(error);
    }
  }

  async deleteNote(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = expenseIdParamSchema.parse(req).params;
      await expenseService.deleteNote(req.user!, id);
      ApiResponse.noContent(res);
    } catch (error) {
      next(error);
    }
  }

  async submitNote(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = expenseIdParamSchema.parse(req).params;
      const expenseNote = await expenseService.submitNote(req.user!, id);
      ApiResponse.success(res, { expenseNote }, 'Expense note submitted successfully');
    } catch (error) {
      next(error);
    }
  }

  async approveNote(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = expenseIdParamSchema.parse(req).params;
      const expenseNote = await expenseService.approveNote(req.user!, id);
      ApiResponse.success(res, { expenseNote }, 'Expense note approved successfully');
    } catch (error) {
      next(error);
    }
  }

  async rejectNote(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = expenseIdParamSchema.parse(req).params;
      const { reason } = expenseReasonSchema.parse(req).body;
      const expenseNote = await expenseService.rejectNote(req.user!, id, reason);
      ApiResponse.success(res, { expenseNote }, 'Expense note rejected successfully');
    } catch (error) {
      next(error);
    }
  }

  async requestChanges(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = expenseIdParamSchema.parse(req).params;
      const { reason } = expenseReasonSchema.parse(req).body;
      const expenseNote = await expenseService.requestChanges(req.user!, id, reason);
      ApiResponse.success(res, { expenseNote }, 'Expense note changes requested successfully');
    } catch (error) {
      next(error);
    }
  }

  async markPaid(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = expenseIdParamSchema.parse(req).params;
      const expenseNote = await expenseService.markPaid(req.user!, id);
      ApiResponse.success(res, { expenseNote }, 'Expense note marked as paid successfully');
    } catch (error) {
      next(error);
    }
  }

  async downloadAttachment(req: Request, res: Response, next: NextFunction) {
    try {
      const { attachmentId } = expenseAttachmentParamSchema.parse(req).params;
      const { attachment, filePath } = await expenseService.getAttachmentForDownload(req.user!, attachmentId);
      res.download(filePath, path.basename(attachment.originalName));
    } catch (error) {
      next(error);
    }
  }

  async deleteAttachment(req: Request, res: Response, next: NextFunction) {
    try {
      const { attachmentId } = expenseAttachmentParamSchema.parse(req).params;
      await expenseService.deleteAttachment(req.user!, attachmentId);
      ApiResponse.noContent(res);
    } catch (error) {
      next(error);
    }
  }

  async analyzeReceipt(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await expenseService.analyzeReceipt(req.user!, req.file);
      ApiResponse.success(res, result, 'Receipt analyzed successfully');
    } catch (error) {
      next(error);
    }
  }
}

export const expenseController = new ExpenseController();
