import { AiToolRiskLevel, PermissionScope, Role } from '@prisma/client';
import { z } from 'zod';

export type AssistantUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  permissions: string[];
  permissionScopes?: Record<string, PermissionScope>;
};

export interface ToolContext {
  user: AssistantUser;
}

export type AiLocalizedText = {
  fr: string;
  en: string;
  ar: string;
};

export type AiBusinessFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'currency'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'select'
  | 'entity'
  | 'array';

export type AiBusinessFieldOption = {
  value: string;
  label: AiLocalizedText;
};

export type AiBusinessFieldDefinition = {
  path: string;
  type: AiBusinessFieldType;
  label: AiLocalizedText;
  description?: AiLocalizedText;
  placeholder?: AiLocalizedText;
  required?: boolean;
  readOnly?: boolean;
  hidden?: boolean;
  options?: AiBusinessFieldOption[];
  entityType?:
    | 'customer'
    | 'contract'
    | 'invoice'
    | 'product'
    | 'expenseCategory'
    | 'expenseType'
    | 'user'
    | 'role'
    | 'permission'
    | 'creditNoteReason';
  itemFields?: AiBusinessFieldDefinition[];
  minItems?: number;
  defaultValue?: unknown;
  resolveDisplayValue?: (value: unknown, draft: Record<string, unknown>, context: ToolContext) => Promise<string | null> | string | null;
};

export type AiBusinessFormDefinition<TInput extends z.ZodTypeAny = z.ZodTypeAny> = {
  title: AiLocalizedText;
  description: AiLocalizedText;
  submitLabel?: AiLocalizedText;
  fields: AiBusinessFieldDefinition[];
  buildInitialValue?: (
    partialInput: Partial<z.input<TInput>>,
    context: ToolContext
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
};

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
  additionalPermissions?: string[];
  anyPermissions?: string[];
  riskLevel: AiToolRiskLevel;
  schema: TInput;
  execute: (input: z.infer<TInput>, context: ToolContext) => Promise<unknown>;
  preview?: (input: z.infer<TInput>, context: ToolContext) => Promise<ToolPreview>;
  form?: AiBusinessFormDefinition<TInput>;
};
