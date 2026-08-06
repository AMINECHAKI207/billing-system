import { Request, Response, NextFunction } from 'express';
import { env } from '@config/env';
import { permissionScope } from '@modules/rbac/accessScope';
import { ApiResponse } from '@utils/ApiResponse';
import { contractService } from './contract.service';
import {
  contractEmailSchema,
  contractBillingActionSchema,
  contractBillingScheduleItemBodySchema,
  contractMilestoneBodySchema,
  contractQuerySchema,
  contractSignatureRevokeSchema,
  contractStatusSchema,
  contractTimeEntryBodySchema,
  contractTimeEntryRejectSchema,
  contractTimeEntryUpdateSchema,
  createContractSchema,
  publicSignatureSchema,
  templateQuerySchema,
  updateContractSchema,
} from './contract.schema';

export class ContractController {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createContractSchema.parse(req).body;
      const contract = await contractService.create(req.user!, permissionScope(req.user!.permissionScopes, 'contracts.create'), data);
      ApiResponse.created(res, { contract }, 'Contract created successfully');
    } catch (error) {
      next(error);
    }
  }

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = contractQuerySchema.parse(req).query;
      const result = await contractService.list(req.user!.id, permissionScope(req.user!.permissionScopes, 'contracts.view'), query);
      ApiResponse.success(res, result, 'Contracts retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const contract = await contractService.getById(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'contracts.view'));
      ApiResponse.success(res, { contract }, 'Contract retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateContractSchema.parse(req).body;
      const contract = await contractService.update(req.params.id!, req.user!, permissionScope(req.user!.permissionScopes, 'contracts.update'), data);
      ApiResponse.success(res, { contract }, 'Contract updated successfully');
    } catch (error) {
      next(error);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await contractService.deleteDraft(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'contracts.delete'));
      ApiResponse.success(res, {}, 'Contract deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { status } = contractStatusSchema.parse(req).body;
      const permission = status === 'CANCELLED'
        ? 'contracts.cancel'
        : status === 'TERMINATED'
          ? 'contracts.terminate'
          : 'contracts.update';
      const contract = await contractService.transition(req.params.id!, req.user!, permissionScope(req.user!.permissionScopes, permission), status);
      ApiResponse.success(res, { contract }, 'Contract status updated successfully');
    } catch (error) {
      next(error);
    }
  }

  async send(req: Request, res: Response, next: NextFunction) {
    try {
      const contract = await contractService.transition(req.params.id!, req.user!, permissionScope(req.user!.permissionScopes, 'contracts.send'), 'SENT');
      ApiResponse.success(res, { contract }, 'Contract sent successfully');
    } catch (error) {
      next(error);
    }
  }

  async cancel(req: Request, res: Response, next: NextFunction) {
    try {
      const contract = await contractService.transition(req.params.id!, req.user!, permissionScope(req.user!.permissionScopes, 'contracts.cancel'), 'CANCELLED');
      ApiResponse.success(res, { contract }, 'Contract cancelled successfully');
    } catch (error) {
      next(error);
    }
  }

  async terminate(req: Request, res: Response, next: NextFunction) {
    try {
      const contract = await contractService.transition(req.params.id!, req.user!, permissionScope(req.user!.permissionScopes, 'contracts.terminate'), 'TERMINATED');
      ApiResponse.success(res, { contract }, 'Contract terminated successfully');
    } catch (error) {
      next(error);
    }
  }

  async signCompany(req: Request, res: Response, next: NextFunction) {
    try {
      const contract = await contractService.signForCompany(req.params.id!, req.user!, permissionScope(req.user!.permissionScopes, 'contracts.sign.company'));
      ApiResponse.success(res, { contract }, 'Contract signed successfully');
    } catch (error) {
      next(error);
    }
  }

  async revokeSignature(req: Request, res: Response, next: NextFunction) {
    try {
      const data = contractSignatureRevokeSchema.parse(req).body;
      const contract = await contractService.revokeSignature(req.params.id!, req.user!, permissionScope(req.user!.permissionScopes, 'contracts.signature.revoke'), data);
      ApiResponse.success(res, { contract }, 'Contract signature revoked successfully');
    } catch (error) {
      next(error);
    }
  }

  async downloadPdf(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await contractService.downloadPdf(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'contracts.pdf.download'), String(req.query.language ?? ''));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
      res.end(result.buffer);
    } catch (error) {
      next(error);
    }
  }

  async previewPdf(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await contractService.previewPdf(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'contracts.pdf.preview'), String(req.query.language ?? ''));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${result.fileName}"`);
      res.end(result.buffer);
    } catch (error) {
      next(error);
    }
  }

  async sendEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const data = contractEmailSchema.parse(req).body;
      const result = await contractService.sendByEmail(
        req.params.id!,
        req.user!,
        permissionScope(req.user!.permissionScopes, 'contracts.email.send'),
        data,
        env.CLIENT_URL
      );
      ApiResponse.success(res, result, 'Contract email sent successfully');
    } catch (error) {
      next(error);
    }
  }

  async emailHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const emailLogs = await contractService.getEmailHistory(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'contracts.email.history'));
      ApiResponse.success(res, { emailLogs }, 'Contract email history retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async createTimeEntry(req: Request, res: Response, next: NextFunction) {
    try {
      const data = contractTimeEntryBodySchema.parse(req.body);
      const entry = await contractService.createTimeEntry(req.params.id!, req.user!, permissionScope(req.user!.permissionScopes, 'contracts.time_entries.create'), data);
      ApiResponse.created(res, { entry }, 'Contract time entry created successfully');
    } catch (error) {
      next(error);
    }
  }

  async updateTimeEntry(req: Request, res: Response, next: NextFunction) {
    try {
      const data = contractTimeEntryUpdateSchema.parse(req.body);
      const entry = await contractService.updateTimeEntry(req.params.id!, req.params.entryId!, req.user!, permissionScope(req.user!.permissionScopes, 'contracts.time_entries.update'), data);
      ApiResponse.success(res, { entry }, 'Contract time entry updated successfully');
    } catch (error) {
      next(error);
    }
  }

  async submitTimeEntry(req: Request, res: Response, next: NextFunction) {
    try {
      const entry = await contractService.submitTimeEntry(req.params.id!, req.params.entryId!, req.user!, permissionScope(req.user!.permissionScopes, 'contracts.time_entries.submit'));
      ApiResponse.success(res, { entry }, 'Contract time entry submitted successfully');
    } catch (error) {
      next(error);
    }
  }

  async approveTimeEntry(req: Request, res: Response, next: NextFunction) {
    try {
      const entry = await contractService.approveTimeEntry(req.params.id!, req.params.entryId!, req.user!, permissionScope(req.user!.permissionScopes, 'contracts.time_entries.approve'));
      ApiResponse.success(res, { entry }, 'Contract time entry approved successfully');
    } catch (error) {
      next(error);
    }
  }

  async rejectTimeEntry(req: Request, res: Response, next: NextFunction) {
    try {
      const data = contractTimeEntryRejectSchema.parse(req.body);
      const entry = await contractService.rejectTimeEntry(req.params.id!, req.params.entryId!, req.user!, permissionScope(req.user!.permissionScopes, 'contracts.time_entries.reject'), data);
      ApiResponse.success(res, { entry }, 'Contract time entry rejected successfully');
    } catch (error) {
      next(error);
    }
  }

  async createMilestone(req: Request, res: Response, next: NextFunction) {
    try {
      const data = contractMilestoneBodySchema.parse(req.body);
      const milestone = await contractService.createMilestone(req.params.id!, req.user!, permissionScope(req.user!.permissionScopes, 'contracts.milestones.manage'), data);
      ApiResponse.created(res, { milestone }, 'Contract milestone created successfully');
    } catch (error) {
      next(error);
    }
  }

  async approveMilestone(req: Request, res: Response, next: NextFunction) {
    try {
      const milestone = await contractService.approveMilestone(req.params.id!, req.params.milestoneId!, req.user!, permissionScope(req.user!.permissionScopes, 'contracts.milestones.manage'));
      ApiResponse.success(res, { milestone }, 'Contract milestone approved successfully');
    } catch (error) {
      next(error);
    }
  }

  async createBillingScheduleItem(req: Request, res: Response, next: NextFunction) {
    try {
      const data = contractBillingScheduleItemBodySchema.parse(req.body);
      const item = await contractService.createBillingScheduleItem(req.params.id!, req.user!, permissionScope(req.user!.permissionScopes, 'contracts.pricing.manage'), data);
      ApiResponse.created(res, { item }, 'Contract billing schedule item created successfully');
    } catch (error) {
      next(error);
    }
  }

  async generateInvoice(req: Request, res: Response, next: NextFunction) {
    try {
      const data = contractBillingActionSchema.parse(req).body;
      const invoice = await contractService.generateBillingInvoice(req.params.id!, req.user!, permissionScope(req.user!.permissionScopes, 'contracts.billing.generate'), data);
      ApiResponse.created(res, { invoice }, 'Contract invoice generated successfully');
    } catch (error) {
      next(error);
    }
  }

  async listTemplates(req: Request, res: Response, next: NextFunction) {
    try {
      const query = templateQuerySchema.parse(req).query;
      const templates = await contractService.listTemplates(query.includeInactive);
      ApiResponse.success(res, { templates }, 'Contract templates retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async publicView(req: Request, res: Response, next: NextFunction) {
    try {
      const contract = await contractService.getPublicContract(req.params.token!, req.ip, req.get('user-agent'));
      ApiResponse.success(res, { contract }, 'Contract retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async publicSign(req: Request, res: Response, next: NextFunction) {
    try {
      const data = publicSignatureSchema.parse(req).body;
      const contract = await contractService.signPublicContract(req.params.token!, data, req.ip, req.get('user-agent'));
      ApiResponse.success(res, { contract }, 'Contract signed successfully');
    } catch (error) {
      next(error);
    }
  }
}

export const contractController = new ContractController();
