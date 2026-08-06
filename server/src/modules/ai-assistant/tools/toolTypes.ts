import { AiToolRiskLevel, PermissionScope } from '@prisma/client';
import { z } from 'zod';

export type AssistantUser = Express.Request['user'] & {
  id: string;
  name: string;
  email: string;
  permissions: string[];
  permissionScopes?: Record<string, PermissionScope>;
};

export interface ToolContext {
  user: AssistantUser;
}

export type ToolPreview = {
  title: string;
  description: string;
  summary: Record<string, unknown>;
};

export type AiTool<TInput extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  description: string;
  module: string;
  requiredPermission: string;
  riskLevel: AiToolRiskLevel;
  schema: TInput;
  execute: (input: z.infer<TInput>, context: ToolContext) => Promise<unknown>;
  preview?: (input: z.infer<TInput>, context: ToolContext) => Promise<ToolPreview>;
};
