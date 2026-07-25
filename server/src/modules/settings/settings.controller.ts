import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '@utils/ApiResponse';
import { testEmailSchema, updateCompanySettingsSchema } from './settings.schema';
import { settingsService } from './settings.service';

export class SettingsController {
  async getCompany(req: Request, res: Response, next: NextFunction) {
    try {
      const settings = await settingsService.getCompanySettings();
      ApiResponse.success(res, { settings }, 'Company settings retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async updateCompany(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateCompanySettingsSchema.parse(req).body;
      const settings = await settingsService.updateCompanySettings(data);
      ApiResponse.success(res, { settings }, 'Company settings updated successfully');
    } catch (error) {
      next(error);
    }
  }

  async uploadSignature(req: Request, res: Response, next: NextFunction) {
    try {
      const settings = await settingsService.uploadCompanyAsset('signature', req.file);
      ApiResponse.success(res, { settings }, 'Company signature uploaded successfully');
    } catch (error) {
      next(error);
    }
  }

  async deleteSignature(req: Request, res: Response, next: NextFunction) {
    try {
      const settings = await settingsService.deleteCompanyAsset('signature');
      ApiResponse.success(res, { settings }, 'Company signature deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  async removeSignatureBackground(req: Request, res: Response, next: NextFunction) {
    try {
      const settings = await settingsService.removeCompanyAssetBackground('signature');
      ApiResponse.success(res, { settings }, 'Company signature background removed successfully');
    } catch (error) {
      next(error);
    }
  }

  async removeBackgroundPreview(req: Request, res: Response, next: NextFunction) {
    try {
      const png = await settingsService.removeCompanyAssetBackgroundPreview(req.file);
      res.status(200).type('image/png').send(png);
    } catch (error) {
      next(error);
    }
  }

  async uploadStamp(req: Request, res: Response, next: NextFunction) {
    try {
      const settings = await settingsService.uploadCompanyAsset('stamp', req.file);
      ApiResponse.success(res, { settings }, 'Company stamp uploaded successfully');
    } catch (error) {
      next(error);
    }
  }

  async deleteStamp(req: Request, res: Response, next: NextFunction) {
    try {
      const settings = await settingsService.deleteCompanyAsset('stamp');
      ApiResponse.success(res, { settings }, 'Company stamp deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  async removeStampBackground(req: Request, res: Response, next: NextFunction) {
    try {
      const settings = await settingsService.removeCompanyAssetBackground('stamp');
      ApiResponse.success(res, { settings }, 'Company stamp background removed successfully');
    } catch (error) {
      next(error);
    }
  }

  async getEmailStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const emailStatus = settingsService.getEmailStatus();
      ApiResponse.success(res, { emailStatus }, 'Email delivery status retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async sendTestEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const data = testEmailSchema.parse(req).body;
      const result = await settingsService.sendTestEmail(req.user!, data);
      ApiResponse.success(res, result, 'Test email sent successfully');
    } catch (error) {
      next(error);
    }
  }

  async getEmailLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const emailLogs = await settingsService.getRecentEmailLogs();
      ApiResponse.success(res, { emailLogs }, 'Recent email logs retrieved successfully');
    } catch (error) {
      next(error);
    }
  }
}

export const settingsController = new SettingsController();
