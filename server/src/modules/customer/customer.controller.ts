import { Request, Response, NextFunction } from 'express';
import { customerService } from './customer.service';
import { createCustomerSchema, updateCustomerSchema, customerQuerySchema } from './customer.schema';
import { ApiResponse } from '@utils/ApiResponse';
import { permissionScope } from '@modules/rbac/accessScope';

export class CustomerController {
  /**
   * Create a new customer
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createCustomerSchema.parse(req).body;
      const userId = req.user!.id; // Authenticated via middleware

      const customer = await customerService.createCustomer(userId, data);
      
      ApiResponse.created(res, { customer }, 'Customer created successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all customers (with pagination and search)
   */
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const query = customerQuerySchema.parse(req).query;
      
      const result = await customerService.getCustomers(req.user!.id, permissionScope(req.user!.permissionScopes, 'clients.view'), query);
      
      ApiResponse.success(res, result, 'Customers retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get a single customer
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const customer = await customerService.getCustomerById(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'clients.view'));
      ApiResponse.success(res, { customer }, 'Customer retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update a customer
   */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateCustomerSchema.parse(req).body;
      const customer = await customerService.updateCustomer(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'clients.update'), data);
      
      ApiResponse.success(res, { customer }, 'Customer updated successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete a customer
   */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await customerService.deleteCustomer(req.params.id!, req.user!.id, permissionScope(req.user!.permissionScopes, 'clients.delete'));
      ApiResponse.success(res, null, 'Customer deleted successfully');
    } catch (error) {
      next(error);
    }
  }
}

export const customerController = new CustomerController();
