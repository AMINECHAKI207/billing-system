import { NextFunction, Request, Response } from 'express';
import { ApiResponse } from '@utils/ApiResponse';
import { permissionScope } from '@modules/rbac/accessScope';
import { recurringService } from './recurring.service';
import { createRecurringPlanSchema, recurringPlanQuerySchema, updateRecurringPlanSchema, updateRecurringStatusSchema } from './recurring.schema';

export class RecurringController {
  async list(req: Request,res: Response,next: NextFunction){try{const q=recurringPlanQuerySchema.parse(req).query;const result=await recurringService.list(req.user!.id,permissionScope(req.user!.permissionScopes,'recurring.view'),q);ApiResponse.success(res,result,'Recurring plans retrieved');}catch(e){next(e)}}
  async get(req: Request,res: Response,next: NextFunction){try{const plan=await recurringService.getById(req.params.id!,req.user!.id,permissionScope(req.user!.permissionScopes,'recurring.view'));ApiResponse.success(res,{plan},'Recurring plan retrieved');}catch(e){next(e)}}
  async create(req: Request,res: Response,next: NextFunction){try{const data=createRecurringPlanSchema.parse(req).body;const plan=await recurringService.create(req.user!,permissionScope(req.user!.permissionScopes,'recurring.create'),data);ApiResponse.created(res,{plan},'Recurring plan created');}catch(e){next(e)}}
  async update(req: Request,res: Response,next: NextFunction){try{const data=updateRecurringPlanSchema.parse(req).body;const plan=await recurringService.update(req.params.id!,req.user!,permissionScope(req.user!.permissionScopes,'recurring.update'),data);ApiResponse.success(res,{plan},'Recurring plan updated');}catch(e){next(e)}}
  async status(req: Request,res: Response,next: NextFunction){try{const {status}=updateRecurringStatusSchema.parse(req).body;const plan=await recurringService.changeStatus(req.params.id!,req.user!.id,permissionScope(req.user!.permissionScopes,'recurring.update'),status);ApiResponse.success(res,{plan},'Recurring plan status updated');}catch(e){next(e)}}
  async run(req: Request,res: Response,next: NextFunction){try{const execution=await recurringService.runNow(req.params.id!,req.user!,permissionScope(req.user!.permissionScopes,'recurring.run'));ApiResponse.success(res,{execution},'Recurring plan executed');}catch(e){next(e)}}
}
export const recurringController=new RecurringController();
