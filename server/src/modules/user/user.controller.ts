import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '@utils/ApiResponse';
import { createUserSchema, updateUserSchema, userQuerySchema } from './user.schema';
import { userService } from './user.service';

export class UserController {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const query = userQuerySchema.parse(req).query;
      const result = await userService.getUsers(query);
      ApiResponse.success(res, result, 'Users retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createUserSchema.parse(req).body;
      const user = await userService.createUser(data);
      ApiResponse.created(res, { user }, 'User created successfully');
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateUserSchema.parse(req).body;
      const user = await userService.updateUser(req.params.id!, req.user!.id, data);
      ApiResponse.success(res, { user }, 'User updated successfully');
    } catch (error) {
      next(error);
    }
  }
}

export const userController = new UserController();
