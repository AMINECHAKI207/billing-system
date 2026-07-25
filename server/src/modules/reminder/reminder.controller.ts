import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '@utils/ApiResponse';
import { createReminderSchema, reminderQuerySchema } from './reminder.schema';
import { reminderService } from './reminder.service';

export class ReminderController {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createReminderSchema.parse(req).body;
      const reminder = await reminderService.createReminder(req.user!.id, data);

      ApiResponse.created(res, { reminder }, 'Reminder created successfully');
    } catch (error) {
      next(error);
    }
  }

  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const query = reminderQuerySchema.parse(req).query;
      const result = await reminderService.getReminders(query);

      ApiResponse.success(res, result, 'Reminders retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async runAutomatic(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await reminderService.createAutomaticReminderDrafts();
      ApiResponse.created(res, result, 'Automatic reminder drafts generated successfully');
    } catch (error) {
      next(error);
    }
  }
}

export const reminderController = new ReminderController();
