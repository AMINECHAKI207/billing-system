import { AiActionStatus, AiMessageRole, AiToolRiskLevel, Prisma } from '@prisma/client';
import { z } from 'zod';
import { env } from '@config/env';
import { prisma } from '@config/database';
import { auditService } from '@modules/audit/audit.service';
import { contractService } from '@modules/contract/contract.service';
import {
  authorizePermission,
  contractAccessWhere,
  creditNoteAccessWhere,
  devisAccessWhere,
  permissionScope,
} from '@modules/rbac/accessScope';
import { invoiceService } from '@modules/invoice/invoice.service';
import { ApiError } from '@utils/ApiError';
import { getCountryName, normalizeCountryCode } from '@utils/countries';
import { AI_ASSISTANT_PERMISSIONS } from './aiAssistant.permissions';
import { aiTools, toolInputHash } from './tools/contractTools';
import { businessIntelligenceTools } from './tools/businessIntelligenceTools';
import { erpTools } from './tools/erpTools';
import { createEnterpriseWorkflowTools } from './workflows/workflowEngine';
import type { AiMessageInput, AiToolExecutionInput } from './aiAssistant.schema';
import type {
  AssistantUser,
  AiBusinessFieldDefinition,
  AiBusinessFormDefinition,
  AiLocalizedText,
  AiTool,
  ToolContext,
} from './tools/toolTypes';

// Business domains/actions the semantic classifier is allowed to report. This is a
// closed vocabulary for AUDIT/CLASSIFICATION purposes only — actual tool selection is
// still constrained to whatever exists in the live tool registry (`this.tools`), never
// to this list, so it can stay stable even as tools are added/removed.
const SEMANTIC_INTENT_DOMAINS = [
  'invoices', 'quotes', 'contracts', 'clients', 'payments', 'expenses',
  'credit_notes', 'timesheets', 'reports', 'pdf', 'email', 'workflow', 'other',
] as const;
const SEMANTIC_INTENT_ACTIONS = [
  'create', 'read', 'update', 'delete', 'send', 'generate', 'approve', 'reject', 'convert', 'other',
] as const;

const semanticClassificationSchema = z.object({
  intent: z.object({
    domain: z.enum(SEMANTIC_INTENT_DOMAINS),
    action: z.enum(SEMANTIC_INTENT_ACTIONS),
    isWrite: z.boolean(),
    needsClarification: z.boolean(),
  }),
  response: z.string().min(1),
  toolCall: z.object({
    name: z.string().min(1),
    input: z.record(z.unknown()).default({}),
  }).nullish(),
});

type SemanticIntent = z.infer<typeof semanticClassificationSchema>['intent'];

type AssistantPlan = {
  response: string;
  intent?: string;
  toolCall?: {
    name: string;
    input: Record<string, unknown>;
  };
  formRequest?: {
    toolName: string;
    input: Record<string, unknown>;
  };
  // Present only when the plan came from the semantic classifier — used for
  // richer audit logging (domain/action/isWrite/needsClarification).
  semanticIntent?: SemanticIntent;
};

type AssistantContextReference = {
  contractId?: string;
  contractReference?: string;
  invoiceId?: string;
  invoiceReference?: string;
  clientId?: string;
  clientReference?: string;
  source: 'page' | 'conversation';
};

type AssistantIntentName =
  | 'create_customer'
  | 'create_invoice'
  | 'create_product'
  | 'create_quote'
  | 'generate_pdf'
  | 'timesheet'
  | 'payment'
  | 'contract'
  | 'customer'
  | 'reports'
  | 'search'
  | 'approval_center'
  | 'contract_risk'
  | 'customer_risk'
  | 'overdue_invoices'
  | 'invoice_recommendations'
  | 'executive_briefing';

type DetectedAssistantIntent = {
  name: AssistantIntentName;
  confidence: number;
};

export class AiAssistantService {
  private tools = new Map<string, AiTool>();

  constructor() {
    this.registerTools(aiTools);
    this.registerTools(businessIntelligenceTools);
    this.registerTools(erpTools);
    this.registerTools(createEnterpriseWorkflowTools(this.tools));
  }

  private registerTools(tools: AiTool[]) {
    for (const tool of tools) {
      if (this.tools.has(tool.name)) {
        throw new Error(`AI assistant tool "${tool.name}" is already registered. Duplicate tool names are not allowed.`);
      }
      this.tools.set(tool.name, tool);
    }
  }

  listTools(user: AssistantUser) {
    return [...this.tools.values()]
      .filter((tool) => this.canUseTool(user, tool).allowed)
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        module: tool.module,
        riskLevel: tool.riskLevel,
        requiredPermission: tool.requiredPermission,
        additionalPermissions: tool.additionalPermissions ?? [],
      }));
  }

  async briefing(user: AssistantUser) {
    const tool = this.tools.get('get_executive_briefing');
    if (!tool) throw ApiError.badRequest('The executive briefing capability is not available.');
    await this.assertCanUseTool(user, tool);
    const input = tool.schema.parse({ limit: 8 });
    const briefing = await tool.execute(input, { user });
    await this.logAudit(user.id, 'AI_BRIEFING_VIEWED', 'AiConversation', null, {
      resultSummary: this.summarizeResult(briefing),
    });
    return briefing;
  }

  async createConversation(user: AssistantUser, input: { title?: string; language?: string }) {
    const conversation = await prisma.aiConversation.create({
      data: {
        userId: user.id,
        title: input.title?.trim() || null,
        language: input.language ?? 'fr',
      },
      include: { messages: true, pendingActions: true },
    });
    await auditService.logBusinessAction({
      module: 'ai_assistant',
      entity: 'AiConversation',
      entityId: conversation.id,
      action: 'AI_CONVERSATION_STARTED',
      metadata: { title: conversation.title, language: conversation.language },
      userId: user.id,
    });
    return conversation;
  }

  async history(user: AssistantUser, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      prisma.aiConversation.findMany({
        where: { userId: user.id, status: 'ACTIVE' },
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          messages: { orderBy: { createdAt: 'asc' }, take: 20 },
          pendingActions: { orderBy: { createdAt: 'desc' }, take: 10 },
        },
      }),
      prisma.aiConversation.count({ where: { userId: user.id, status: 'ACTIVE' } }),
    ]);
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async getConversation(user: AssistantUser, conversationId: string) {
    const conversation = await prisma.aiConversation.findFirst({
      where: { id: conversationId, userId: user.id },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        pendingActions: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!conversation) throw ApiError.notFound('AI conversation');
    return conversation;
  }

  async archiveConversation(user: AssistantUser, conversationId: string) {
    const conversation = await prisma.aiConversation.findFirst({
      where: { id: conversationId, userId: user.id },
    });
    if (!conversation) throw ApiError.notFound('AI conversation');
    const updated = await prisma.aiConversation.update({
      where: { id: conversation.id },
      data: { status: 'ARCHIVED' },
    });
    await this.logAudit(user.id, 'AI_CONVERSATION_ARCHIVED', 'AiConversation', conversation.id, {
      conversationId: conversation.id,
    });
    return updated;
  }

  async sendMessage(user: AssistantUser, conversationId: string, input: AiMessageInput) {
    const conversation = await this.getConversation(user, conversationId);
    await prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: AiMessageRole.USER,
        content: input.content,
        sanitizedContent: this.sanitizeText(input.content),
      },
    });
    await this.logAudit(user.id, 'AI_MESSAGE_RECEIVED', 'AiMessage', null, {
      conversationId: conversation.id,
      language: input.language,
      contentLength: input.content.length,
    });

    let plan = await this.planResponse(user, conversation.id, input);
    const blockedPlan = await this.prevalidatePlannedToolCall(user, input.language, plan);
    if (blockedPlan) {
      plan = blockedPlan;
    }
    const unavailablePlan = await this.filterUnavailableToolPlan(user, input.language, plan);
    if (unavailablePlan) {
      plan = unavailablePlan;
    }
    await this.logAudit(user.id, 'AI_INTENT_DETECTED', 'AiConversation', conversation.id, {
      intent: plan.intent ?? 'unknown',
      hasToolCall: Boolean(plan.toolCall),
      classifiedBy: plan.semanticIntent ? 'semantic' : 'keyword_fallback',
      domain: plan.semanticIntent?.domain,
      action: plan.semanticIntent?.action,
      isWrite: plan.semanticIntent?.isWrite,
      needsClarification: plan.semanticIntent?.needsClarification,
    });
    let executionResult: unknown = null;

    if (plan.toolCall) {
      executionResult = await this.executeTool(user, {
        conversationId: conversation.id,
        language: input.language,
        toolName: plan.toolCall.name,
        input: plan.toolCall.input,
      });
    }

    const assistantMessage = await prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: AiMessageRole.ASSISTANT,
        content: plan.response,
        sanitizedContent: this.sanitizeText(plan.response),
        metadata: this.toJson({ executionResult: this.compactExecutionResult(executionResult) }),
      },
    });

    await prisma.aiConversation.update({
      where: { id: conversation.id },
      data: {
        title: conversation.title ?? this.makeTitle(input.content),
        language: input.language ?? conversation.language,
      },
    });

    return { message: assistantMessage, executionResult };
  }

  async executeTool(user: AssistantUser, input: AiToolExecutionInput) {
    const tool = this.tools.get(input.toolName);
    if (!tool) throw ApiError.badRequest('I could not find an authorized ERP action for that request.');
    await this.assertCanUseTool(user, tool);
    await this.logAudit(user.id, 'AI_TOOL_SELECTED', 'AiTool', null, {
      toolName: tool.name,
      riskLevel: tool.riskLevel,
      requiredPermission: tool.requiredPermission,
    });

    const context: ToolContext = { user };
    const language = await this.resolveExecutionLanguage(user, input);
    const preparedInput = await this.prepareWriteToolInput(tool, input.input, context, language);

    if (preparedInput.form) {
      return {
        type: 'structured_form',
        toolName: tool.name,
        form: preparedInput.form,
      };
    }

    const parsed = tool.schema.parse(preparedInput.input);

    if (tool.riskLevel === AiToolRiskLevel.READ_ONLY) {
      try {
        const result = await tool.execute(parsed, context);
        await this.logAudit(user.id, 'AI_TOOL_EXECUTED', 'AiTool', null, {
          toolName: tool.name,
          riskLevel: tool.riskLevel,
          resultSummary: this.summarizeResult(result),
        });
        await this.logReadToolBusinessEvent(user.id, tool, result);
        return { type: 'tool_result', toolName: tool.name, result };
      } catch (error) {
        await this.logAudit(user.id, 'AI_TOOL_FAILED', 'AiTool', null, {
          toolName: tool.name,
          message: error instanceof Error ? error.message : 'Unknown error',
        }, false);
        throw error;
      }
    }

    const conversationId = input.conversationId ?? (await this.createConversation(user, { title: `Action: ${tool.name}` })).id;
    const preview = tool.preview
      ? await tool.preview(parsed, context)
      : { title: tool.name, description: tool.description, summary: this.toJson(parsed) as Record<string, unknown> };
    await this.logAudit(user.id, 'AI_TOOL_PREVIEWED', 'AiTool', null, {
      toolName: tool.name,
      riskLevel: tool.riskLevel,
      previewTitle: preview.title,
    });
    const idempotencyKey = input.idempotencyKey ?? `ai-${tool.name}-${toolInputHash(tool.name, parsed, user.id).slice(0, 64)}`;
    const action = await this.createOrReusePendingAction({
      userId: user.id,
      conversationId,
      tool,
      parsed,
      preview,
      idempotencyKey,
      replaceActionId: input.replaceActionId,
    });

    await this.logAudit(user.id, 'AI_ACTION_CONFIRMATION_REQUESTED', 'AiPendingAction', action.id, {
      toolName: tool.name,
      status: action.status,
      requiredPermission: action.requiredPermission,
      expiresAt: action.expiresAt.toISOString(),
    });

    return { type: 'pending_action', action };
  }

  private async createOrReusePendingAction(input: {
    userId: string;
    conversationId: string;
    tool: AiTool;
    parsed: unknown;
    preview: unknown;
    idempotencyKey: string;
    replaceActionId?: string;
  }) {
    if (input.replaceActionId) {
      const existingAction = await prisma.aiPendingAction.findFirst({
        where: {
          id: input.replaceActionId,
          userId: input.userId,
        },
      });
      if (!existingAction) throw ApiError.notFound('AI pending action');
      if (existingAction.status !== AiActionStatus.PENDING) {
        throw ApiError.conflict('This AI action is no longer pending');
      }
      if (existingAction.toolName !== input.tool.name) {
        throw ApiError.conflict('This AI action cannot be revised with another tool');
      }

      return prisma.aiPendingAction.update({
        where: { id: existingAction.id },
        data: {
          conversationId: input.conversationId,
          inputPayload: this.toJson(input.parsed) as Prisma.InputJsonValue,
          previewPayload: this.toJson(input.preview) as Prisma.InputJsonValue,
          riskLevel: input.tool.riskLevel,
          requiredPermission: input.tool.requiredPermission,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          errorPayload: Prisma.JsonNull,
        },
      });
    }

    const existing = await prisma.aiPendingAction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing?.userId === input.userId && existing.status === AiActionStatus.PENDING && existing.expiresAt.getTime() > Date.now()) {
      return existing;
    }
    if (existing?.userId === input.userId && existing.status === AiActionStatus.PENDING && existing.expiresAt.getTime() <= Date.now()) {
      await prisma.aiPendingAction.update({
        where: { id: existing.id },
        data: { status: AiActionStatus.EXPIRED },
      });
    }

    const actionInput = {
      userId: input.userId,
      conversationId: input.conversationId,
      toolName: input.tool.name,
      inputPayload: this.toJson(input.parsed) as Prisma.InputJsonValue,
      previewPayload: this.toJson(input.preview) as Prisma.InputJsonValue,
      riskLevel: input.tool.riskLevel,
      requiredPermission: input.tool.requiredPermission,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    };
    if (!existing) {
      return prisma.aiPendingAction.create({
        data: {
          ...actionInput,
          idempotencyKey: input.idempotencyKey,
        },
      });
    }

    return prisma.aiPendingAction.create({
      data: {
        ...actionInput,
        idempotencyKey: `${input.idempotencyKey}-${Date.now()}`,
      },
    });
  }

  private async resolveExecutionLanguage(user: AssistantUser, input: AiToolExecutionInput) {
    if (input.language) return input.language;
    if (input.conversationId) {
      const conversation = await prisma.aiConversation.findFirst({
        where: { id: input.conversationId, userId: user.id },
        select: { language: true },
      });
      if (conversation?.language === 'fr' || conversation?.language === 'en' || conversation?.language === 'ar') {
        return conversation.language;
      }
    }
    return 'fr';
  }

  private async prepareWriteToolInput(
    tool: AiTool,
    rawInput: Record<string, unknown>,
    context: ToolContext,
    language: 'fr' | 'en' | 'ar'
  ): Promise<{ input: Record<string, unknown>; form?: Record<string, unknown> }> {
    if (tool.riskLevel === AiToolRiskLevel.READ_ONLY || !tool.form) {
      return { input: rawInput };
    }

    const defaults = tool.form.buildInitialValue
      ? await tool.form.buildInitialValue(rawInput, context)
      : this.defaultFormValues(tool.form.fields);
    const merged = this.deepMerge(defaults, rawInput);
    const normalized = this.normalizeStructuredFormDraft(tool.form.fields, merged);
    const missingFields = this.collectMissingRequiredFields(tool.form.fields, normalized);

    if (!missingFields.length && !this.shouldForceStructuredForm(tool.form.fields, rawInput)) {
      return { input: normalized };
    }

    return {
      input: normalized,
      form: await this.serializeStructuredForm(tool.name, tool.form, normalized, missingFields, context, language),
    };
  }

  private defaultFormValues(fields: AiBusinessFieldDefinition[]) {
    const defaults: Record<string, unknown> = {};
    for (const field of fields) {
      if (field.hidden) continue;
      if (field.type === 'array') {
        this.setNestedValue(defaults, field.path, Array.isArray(field.defaultValue) ? field.defaultValue : []);
        continue;
      }
      if (field.defaultValue !== undefined) {
        this.setNestedValue(defaults, field.path, field.defaultValue);
      }
    }
    return defaults;
  }

  private deepMerge(base: Record<string, unknown>, override: Record<string, unknown>) {
    const output: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(override)) {
      const current = output[key];
      if (
        value
        && typeof value === 'object'
        && !Array.isArray(value)
        && current
        && typeof current === 'object'
        && !Array.isArray(current)
      ) {
        output[key] = this.deepMerge(current as Record<string, unknown>, value as Record<string, unknown>);
      } else {
        output[key] = value;
      }
    }
    return output;
  }

  private collectMissingRequiredFields(fields: AiBusinessFieldDefinition[], draft: Record<string, unknown>) {
    const missing: string[] = [];
    for (const field of fields) {
      if (field.hidden || !field.required) continue;
      const value = this.getNestedValue(draft, field.path);
      if (field.type === 'array') {
        const items = Array.isArray(value) ? value : [];
        if (items.length < (field.minItems ?? 1)) {
          missing.push(field.path);
        }
        continue;
      }
      if (this.isEmptyFormValue(value)) {
        missing.push(field.path);
      }
    }
    return missing;
  }

  private normalizeStructuredFormDraft(fields: AiBusinessFieldDefinition[], draft: Record<string, unknown>) {
    const output = structuredClone(draft);
    for (const field of fields) {
      if (field.type !== 'array' || !field.itemFields?.length) continue;
      const items = this.getNestedValue(output, field.path);
      if (!Array.isArray(items)) continue;
      if (field.itemFields.length !== 1) continue;
      const itemField = field.itemFields[0]!;
      const normalizedItems = items.map((item) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          return (item as Record<string, unknown>)[itemField.path];
        }
        return item;
      });
      this.setNestedValue(output, field.path, normalizedItems);
    }
    return output;
  }

  private shouldForceStructuredForm(fields: AiBusinessFieldDefinition[], rawInput: Record<string, unknown>) {
    const editableFields = fields.filter((field) => !field.hidden && !field.readOnly);
    if (!editableFields.length) return false;
    return !editableFields.some((field) => !this.isEmptyFormValue(this.getNestedValue(rawInput, field.path)));
  }

  private isEmptyFormValue(value: unknown) {
    if (value == null) return true;
    if (typeof value === 'string') return !value.trim();
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length === 0;
    return false;
  }

  private async serializeStructuredForm(
    toolName: string,
    form: AiBusinessFormDefinition,
    draft: Record<string, unknown>,
    missingFields: string[],
    context: ToolContext,
    language: 'fr' | 'en' | 'ar'
  ) {
    const fields = await Promise.all(form.fields.map(async (field) => {
      const value = this.getNestedValue(draft, field.path);
      const displayValue = field.resolveDisplayValue
        ? await field.resolveDisplayValue(value, draft, context)
        : null;
      return {
        path: field.path,
        type: field.type,
        label: this.localizeFieldText(field.label, language),
        description: field.description ? this.localizeFieldText(field.description, language) : undefined,
        placeholder: field.placeholder ? this.localizeFieldText(field.placeholder, language) : undefined,
        required: Boolean(field.required),
        readOnly: Boolean(field.readOnly),
        hidden: Boolean(field.hidden),
        entityType: field.entityType,
        minItems: field.minItems,
        value,
        displayValue: displayValue ?? undefined,
        options: field.options?.map((option) => ({
          value: option.value,
          label: this.localizeFieldText(option.label, language),
        })),
        itemFields: field.itemFields?.map((itemField) => ({
          path: itemField.path,
          type: itemField.type,
          label: this.localizeFieldText(itemField.label, language),
          description: itemField.description ? this.localizeFieldText(itemField.description, language) : undefined,
          placeholder: itemField.placeholder ? this.localizeFieldText(itemField.placeholder, language) : undefined,
          required: Boolean(itemField.required),
          readOnly: Boolean(itemField.readOnly),
          hidden: Boolean(itemField.hidden),
          entityType: itemField.entityType,
          options: itemField.options?.map((option) => ({
            value: option.value,
            label: this.localizeFieldText(option.label, language),
          })),
        })),
      };
    }));

    return {
      title: this.localizeFieldText(form.title, language),
      description: this.localizeFieldText(form.description, language),
      submitLabel: this.localizeFieldText(
        form.submitLabel ?? {
          fr: 'Générer la prévisualisation',
          en: 'Generate preview',
          ar: 'إنشاء المعاينة',
        },
        language
      ),
      values: draft,
      missingFields,
      fields,
      language,
      toolName,
    };
  }

  private localizeFieldText(text: AiLocalizedText, language: 'fr' | 'en' | 'ar') {
    if (language === 'ar') return text.ar;
    if (language === 'en') return text.en;
    return text.fr;
  }

  private getNestedValue(source: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((current, segment) => {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
      return (current as Record<string, unknown>)[segment];
    }, source);
  }

  private setNestedValue(target: Record<string, unknown>, path: string, value: unknown) {
    const segments = path.split('.');
    const last = segments.pop();
    if (!last) return;
    let current: Record<string, unknown> = target;
    for (const segment of segments) {
      const next = current[segment];
      if (!next || typeof next !== 'object' || Array.isArray(next)) {
        current[segment] = {};
      }
      current = current[segment] as Record<string, unknown>;
    }
    current[last] = value;
  }

  async confirmAction(user: AssistantUser, actionId: string) {
    if (!user.permissions.includes(AI_ASSISTANT_PERMISSIONS.confirmActions)) {
      await this.logPermissionDenied(user.id, AI_ASSISTANT_PERMISSIONS.confirmActions, 'confirm_action');
      throw ApiError.forbidden('AI action confirmation permission is required');
    }
    const action = await prisma.aiPendingAction.findFirst({ where: { id: actionId, userId: user.id } });
    if (!action) throw ApiError.notFound('AI pending action');
    if (action.status === AiActionStatus.EXECUTED) return { action, result: action.resultPayload };
    if (action.status === AiActionStatus.CONFIRMED) {
      const executed = await this.waitForExecutedAction(action.id, user.id);
      if (executed?.status === AiActionStatus.EXECUTED) return { action: executed, result: executed.resultPayload };
      if (executed?.status === AiActionStatus.FAILED) throw ApiError.conflict('This AI action failed while executing');
      if (executed?.status === AiActionStatus.CANCELLED || executed?.status === AiActionStatus.EXPIRED) {
        throw ApiError.conflict('This AI action is no longer pending');
      }
      throw ApiError.conflict('This AI action is already being executed');
    }
    if (action.status !== AiActionStatus.PENDING) throw ApiError.conflict('This AI action is no longer pending');
    if (action.expiresAt.getTime() < Date.now()) {
      await prisma.aiPendingAction.update({ where: { id: action.id }, data: { status: AiActionStatus.EXPIRED } });
      await this.logAudit(user.id, 'AI_ACTION_EXPIRED', 'AiPendingAction', action.id, {
        toolName: action.toolName,
        expiresAt: action.expiresAt.toISOString(),
      }, false);
      throw ApiError.badRequest('This AI action has expired');
    }

    const tool = this.tools.get(action.toolName);
    if (!tool) throw ApiError.badRequest('AI tool is no longer available');
    await this.assertCanUseTool(user, tool);

    const claimed = await prisma.aiPendingAction.updateMany({
      where: { id: action.id, userId: user.id, status: AiActionStatus.PENDING },
      data: { status: AiActionStatus.CONFIRMED, confirmedAt: new Date() },
    });
    if (claimed.count !== 1) {
      const latest = await prisma.aiPendingAction.findFirst({ where: { id: action.id, userId: user.id } });
      if (latest?.status === AiActionStatus.EXECUTED) return { action: latest, result: latest.resultPayload };
      if (latest?.status === AiActionStatus.CONFIRMED) {
        const executed = await this.waitForExecutedAction(action.id, user.id);
        if (executed?.status === AiActionStatus.EXECUTED) return { action: executed, result: executed.resultPayload };
        if (executed?.status === AiActionStatus.FAILED) throw ApiError.conflict('This AI action failed while executing');
        if (executed?.status === AiActionStatus.CANCELLED || executed?.status === AiActionStatus.EXPIRED) {
          throw ApiError.conflict('This AI action is no longer pending');
        }
      }
      throw ApiError.conflict('This AI action is no longer pending');
    }

    try {
      const parsed = tool.schema.parse(action.inputPayload);
      const result = await tool.execute(parsed, { user });
      const updated = await prisma.aiPendingAction.update({
        where: { id: action.id },
        data: {
          status: AiActionStatus.EXECUTED,
          executedAt: new Date(),
          resultPayload: this.toJson(result) as Prisma.InputJsonValue,
        },
      });
      await auditService.logBusinessAction({
        module: 'ai_assistant',
        entity: 'AiPendingAction',
        entityId: action.id,
        action: 'AI_ACTION_CONFIRMED',
        newValues: { toolName: tool.name, status: updated.status },
        userId: user.id,
      });
      await this.logAudit(user.id, 'AI_TOOL_EXECUTED', 'AiTool', null, {
        toolName: tool.name,
        pendingActionId: action.id,
        resultSummary: this.summarizeResult(result),
      });
      if (tool.name.includes('workflow')) {
        await this.logAudit(user.id, 'AI_WORKFLOW_EXECUTION', 'AiPendingAction', action.id, {
          toolName: tool.name,
          pendingActionId: action.id,
          resultSummary: this.summarizeResult(result),
        });
      }
      return { action: updated, result };
    } catch (error) {
      const updated = await prisma.aiPendingAction.update({
        where: { id: action.id },
        data: {
          status: AiActionStatus.FAILED,
          errorPayload: this.toJson({ message: error instanceof Error ? error.message : 'Unknown error' }) as Prisma.InputJsonValue,
        },
      });
      await this.logAudit(user.id, 'AI_TOOL_FAILED', 'AiTool', null, {
        toolName: tool.name,
        pendingActionId: action.id,
        message: error instanceof Error ? error.message : 'Unknown error',
      }, false);
      throw Object.assign(error instanceof Error ? error : ApiError.internal(), { action: updated });
    }
  }

  async cancelAction(user: AssistantUser, actionId: string) {
    const action = await prisma.aiPendingAction.findFirst({ where: { id: actionId, userId: user.id } });
    if (!action) throw ApiError.notFound('AI pending action');
    if (action.status !== AiActionStatus.PENDING) throw ApiError.conflict('Only pending AI actions can be cancelled');
    const updated = await prisma.aiPendingAction.update({
      where: { id: action.id },
      data: { status: AiActionStatus.CANCELLED, cancelledAt: new Date() },
    });
    await this.logAudit(user.id, 'AI_ACTION_CANCELLED', 'AiPendingAction', action.id, {
      toolName: action.toolName,
    });
    return updated;
  }

  private async waitForExecutedAction(actionId: string, userId: string) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const action = await prisma.aiPendingAction.findFirst({ where: { id: actionId, userId } });
      if (!action) return null;
      if (action.status === AiActionStatus.EXECUTED) return action;
      if (action.status === AiActionStatus.FAILED || action.status === AiActionStatus.CANCELLED || action.status === AiActionStatus.EXPIRED) return action;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return null;
  }

  private async assertCanUseTool(user: AssistantUser, tool: AiTool) {
    const authorization = this.canUseTool(user, tool);
    if (!authorization.allowed) {
      const deniedPermission = authorization.missingPermission ?? authorization.assistantPermission;
      await this.logPermissionDenied(user.id, deniedPermission, tool.name);
      if (authorization.reason === 'MISSING_CONFIRM_PERMISSION') {
        throw ApiError.forbidden('You are allowed to prepare this action, but not to confirm and execute it.');
      }
      if (authorization.reason === 'MISSING_ASSISTANT_PERMISSION') {
        throw ApiError.forbidden('You are not allowed to use this assistant action.');
      }
      if (authorization.reason === 'MISSING_PERMISSION_SCOPE') {
        throw ApiError.forbidden(this.friendlyPermissionDenied(authorization.missingPermission ?? tool.requiredPermission));
      }
      throw ApiError.forbidden('You are not allowed to use this assistant action.');
    }
  }

  private friendlyPermissionDenied(permission: string) {
    const resource = permission.split('.')[0] ?? 'resource';
    const labels: Record<string, string> = {
      clients: 'clients',
      contracts: 'contracts',
      customers: 'clients',
      invoices: 'invoices',
      payments: 'payments',
      credit_notes: 'credit notes',
      expense_notes: 'expense notes',
      expense_attachments: 'expense attachments',
      audit_logs: 'audit logs',
    };
    return `You are not allowed to access ${labels[resource] ?? resource}.`;
  }

  private async planResponse(user: AssistantUser, conversationId: string, input: AiMessageInput): Promise<AssistantPlan> {
    const blocked = this.detectUnsafeRequest(input.content, input.language);
    if (blocked) return blocked;

    const normalized = this.normalizeIntentText(input.content);
    const explicitInvoiceRequest = this.matchesAny(normalized, [
      'cree une facture',
      'creer une facture',
      'facture ce contrat',
      'dir facture',
      'facture l ',
      'facture pour',
      'generate invoice',
      'create an invoice',
      'create invoice',
      'invoice ',
      'invoice this contract',
      'bill this contract',
    ]);
    const explicitInvoiceTarget = explicitInvoiceRequest ? this.extractBusinessEntityQuery(input.content) : null;
    const explicitContractInvoiceRequest = explicitInvoiceRequest
      && this.isExplicitContractInvoiceRequest(normalized, input.content, input.context);
    if (input.context?.entityType === 'contract' && input.context.entityId && explicitContractInvoiceRequest) {
      const blockedContractPlan = await this.validateContractInvoiceIntent(
        user,
        input.language,
        input.context.entityId,
        input.context.readableReference,
        true,
        { contractId: input.context.entityId }
      );
      if (blockedContractPlan) {
        return blockedContractPlan;
      }
    }
    if (explicitContractInvoiceRequest && explicitInvoiceTarget) {
      const contract = await this.resolveSingleContract(user, explicitInvoiceTarget);
      if (contract) {
        const blockedContractPlan = await this.validateContractInvoiceIntent(
          user,
          input.language,
          contract.id,
          contract.contractNumber,
          true
        );
        if (blockedContractPlan) return blockedContractPlan;
        return {
          response: this.localized(input.language, {
            fr: `J ai trouve le contrat ${contract.contractNumber ?? ''}. Je prepare la facture a confirmer.`,
            en: `I found contract ${contract.contractNumber ?? ''}. I am preparing the invoice for confirmation.`,
            ar: `عثرت على العقد ${contract.contractNumber ?? ''}. سأحضر الفاتورة للتأكيد.`,
          }),
          intent: 'contract_invoice_workflow',
          toolCall: { name: 'contract_invoice_workflow', input: { contractId: contract.id } },
        };
      }

      const fuzzyContract = await this.resolveInvoiceableContractFromSearch(user, input.language, explicitInvoiceTarget);
      if (fuzzyContract) {
        return {
          response: this.localized(input.language, {
            fr: `J ai rapproche votre demande du contrat ${fuzzyContract.contractNumber ?? ''} pour ${fuzzyContract.clientName ?? explicitInvoiceTarget}. Je prepare la facture a confirmer.`,
            en: `I matched your request to contract ${fuzzyContract.contractNumber ?? ''} for ${fuzzyContract.clientName ?? explicitInvoiceTarget}. I am preparing the invoice for confirmation.`,
            ar: `طابقت طلبك مع العقد ${fuzzyContract.contractNumber ?? ''} الخاص بالعميل ${fuzzyContract.clientName ?? explicitInvoiceTarget}. سأحضر الفاتورة للتأكيد.`,
          }),
          intent: 'contract_invoice_workflow',
          toolCall: { name: 'contract_invoice_workflow', input: { contractId: fuzzyContract.id } },
        };
      }

      const client = await this.resolveSingleClient(user, explicitInvoiceTarget);
      if (client) {
        const clientContract = await this.resolveInvoiceableContractForClient(user, input.language, client.id);
        if (clientContract) {
          return {
            response: this.localized(input.language, {
              fr: `J ai retrouve le client ${client.name ?? explicitInvoiceTarget} et le contrat ${clientContract.contractNumber ?? ''}. Je prepare la facture a confirmer.`,
              en: `I found customer ${client.name ?? explicitInvoiceTarget} and contract ${clientContract.contractNumber ?? ''}. I am preparing the invoice for confirmation.`,
              ar: `عثرت على العميل ${client.name ?? explicitInvoiceTarget} وعلى العقد ${clientContract.contractNumber ?? ''}. سأحضر الفاتورة للتأكيد.`,
            }),
            intent: 'contract_invoice_workflow',
            toolCall: { name: 'contract_invoice_workflow', input: { contractId: clientContract.id } },
          };
        }
      }
    }

    const directTool = this.parseDirectTool(input.content);
    if (directTool) {
      return {
        response: this.localized(input.language, {
          fr: 'Action preparee. Verifiez le resume avant confirmation.',
          en: 'Action prepared. Review the preview before confirming.',
          ar: 'تم تحضير الإجراء. راجع الملخص قبل التأكيد.',
        }),
        intent: 'developer_direct_tool',
        toolCall: directTool,
      };
    }

    // Semantic classification is the PRIMARY, authoritative router: it understands
    // paraphrases and multilingual natural language, then maps the request to an
    // existing tool. Keyword/regex routing below only runs as a non-authoritative
    // fallback when semantic classification is unavailable (no API key configured,
    // network/provider failure, or a malformed/unusable model response).
    const fallback = await this.keywordFallbackPlan(user, conversationId, input.content, input.language, input.context);
    const semanticPlan = await this.classifySemanticIntent(user, conversationId, input).catch(() => null);
    const strategicFallbackIntents = new Set([
      'invoice_recommendations',
      'overdue_invoices',
      'contract_health',
      'customer_health',
      'executive_briefing',
      'approval_center',
    ]);
    const blockingFallbackIntents = new Set([
      'clarify_create_customer',
      'clarify_create_invoice',
      'contract_not_invoiceable',
      'contract_signature_incomplete',
      'contract_no_ready_entries',
      'contract_invoice_prerequisite_missing',
    ]);
    const semanticIsWrite = Boolean(semanticPlan?.semanticIntent?.isWrite);
    if (
      semanticPlan?.toolCall
      && fallback?.toolCall
      && semanticPlan.toolCall.name !== fallback.toolCall.name
      && (
        strategicFallbackIntents.has(fallback.intent ?? '')
        || (
          ['search_contracts', 'search_clients', 'search_invoices'].includes(fallback.toolCall.name)
          && !semanticIsWrite
        )
      )
    ) {
      return fallback;
    }
    if (semanticPlan && fallback && blockingFallbackIntents.has(fallback.intent ?? '')) {
      return fallback;
    }
    if (semanticPlan?.toolCall) return semanticPlan;
    if (semanticPlan && fallback?.toolCall) return fallback;
    if (semanticPlan) return semanticPlan;
    if (fallback) return fallback;

    return {
      response: this.localized(input.language, {
        fr: 'Je peux rechercher des contrats, consulter la consommation, afficher les feuilles de temps, preparer une facture ou retrouver une facture. Donnez-moi une reference comme CTR-2026 ou le nom du client.',
        en: 'I can find contracts, view consumption, show timesheets, prepare invoices or find an invoice. Give me a reference like CTR-2026 or the client name.',
        ar: 'يمكنني البحث عن العقود، عرض الاستهلاك، إظهار سجلات الوقت، إعداد فاتورة أو البحث عن فاتورة. أعطني مرجعا مثل CTR-2026 أو اسم العميل.',
      }),
      intent: 'fallback_help',
    };
  }

  private detectUnsafeRequest(content: string, language: string): AssistantPlan | null {
    const normalized = this.normalizeIntentText(content);
    const unsafePatterns = [
      'ignore previous instructions',
      'ignore les instructions',
      'show me all passwords',
      'password',
      'mot de passe',
      'api key',
      'secret',
      'authorization header',
      'cookie',
      'jwt',
      'execute sql',
      'drop table',
      'delete from',
      'prisma',
      'shell',
      'powershell',
      'skip confirmation',
      'bypass',
      'contourner',
      'pretend i am',
    ];
    if (!unsafePatterns.some((pattern) => normalized.includes(this.normalizeIntentText(pattern)))) return null;
    return {
      response: this.localized(language, {
        fr: 'Je ne peux pas aider a contourner la securite, acceder aux secrets, executer du SQL ou ignorer la confirmation. Je peux uniquement utiliser les actions ERP autorisees.',
        en: 'I cannot help bypass security, access secrets, execute SQL or skip confirmation. I can only use authorized ERP actions.',
        ar: 'لا يمكنني المساعدة في تجاوز الأمان أو الوصول إلى الأسرار أو تنفيذ SQL أو تخطي التأكيد. يمكنني فقط استخدام إجراءات ERP المصرح بها.',
      }),
      intent: 'blocked_unsafe_request',
    };
  }

  private parseDirectTool(content: string): AssistantPlan['toolCall'] | null {
    const match = content.match(/^\/([a-z0-9_]+)\s+([\s\S]+)$/i);
    if (!match?.[1] || !match?.[2]) return null;
    const tool = this.tools.get(match[1]);
    if (!tool) return null;
    try {
      return { name: match[1], input: JSON.parse(match[2]) as Record<string, unknown> };
    } catch {
      throw ApiError.badRequest('I could not understand that action request. Please describe what you want in normal language.');
    }
  }

  /**
   * NON-AUTHORITATIVE FALLBACK ONLY. This keyword/regex router only runs when
   * `classifySemanticIntent` is unavailable (no OPENAI_API_KEY configured, provider
   * failure, or an unusable model response) — see `planResponse`. It must never run
   * after a semantic classification has already succeeded, so it can never override
   * or conflict with it.
   */
  private async keywordFallbackPlan(user: AssistantUser, conversationId: string, content: string, language: string, pageContext?: AiMessageInput['context']): Promise<AssistantPlan | null> {
    const normalized = this.normalizeIntentText(content);
    const contractNumber = content.match(/CTR-\d{4}-\d{4}/i)?.[0];
    const invoiceNumber = content.match(/INV-\d{4}-\d{4}/i)?.[0];
    const routedIntent = this.detectAssistantIntent(normalized);
    const contextReference = await this.resolveContextReference(user, conversationId, pageContext);
    const contextContractId = contextReference.contractId;
    const contextInvoiceId = contextReference.invoiceId;
    const consumptionIntent = this.matchesAny(normalized, ['consommation', 'budget', 'reste', 'remaining', 'consumption', 'ch7al', 'ba9i']);
    const timesheetIntent = this.matchesAny(normalized, ['timesheet', 'timesheets', 'feuille', 'feuilles', 'temps', 'time']);
    const invoiceIntent = this.matchesAny(normalized, ['facture', 'invoice', 'prepare', 'apercu', 'preview', 'genere', 'generate']);
    const pdfIntent = this.matchesAny(normalized, ['pdf', 'telecharge', 'download', 'generate', 'genere']);
    const approvedIntent = this.matchesAny(normalized, ['approuve', 'approuvees', 'approved', 'ready', 'pret', 'pretes', 'facturer']);
    const approvalCenterIntent = this.matchesAny(normalized, ['approval center', 'approvals', 'approbations', 'validation', 'validations', 'actions en attente', 'pending approvals', 'pending actions']);
    const executiveBriefingIntent = this.matchesAny(normalized, ['briefing', 'executive summary', 'resume executif', 'résumé exécutif', 'overview today', 'today overview', 'vue executive', 'vue exécutive']);
    const contractHealthIntent = this.matchesAny(normalized, ['contract health', 'sante contrat', 'santé contrat', 'contracts need attention', 'contrats a surveiller', 'risky contracts', 'contrats risques', 'pourquoi ce contrat']);
    const customerHealthIntent = this.matchesAny(normalized, ['customer health', 'client risque', 'client risqué', 'riskiest customer', 'customer risk', 'clients a risque', 'clients à risque']);
    const revenueInsightIntent = this.matchesAny(normalized, ['expected revenue', 'revenue forecast', 'revenu attendu', 'chiffre affaire', 'cash', 'overdue invoices', 'factures en retard', 'what should i invoice', 'que dois je facturer']);
    const todayIntent = this.matchesAny(normalized, ['today', 'aujourd hui', 'aujourdhui', 'lyoum', 'اليوم']);
    const contextContractLabel = contextReference.contractReference ?? this.localized(language, {
      fr: 'le contrat courant',
      en: 'the current contract',
      ar: 'العقد الحالي',
    });
    const contextInvoiceLabel = contextReference.invoiceReference ?? this.localized(language, {
      fr: 'la facture courante',
      en: 'the current invoice',
      ar: 'الفاتورة الحالية',
    });
    const refersToCurrentContract = Boolean(contextContractId) && this.matchesAny(normalized, ['ce contrat', 'this contract', 'had contrat', 'هذا العقد']);
    const refersToCurrentInvoice = Boolean(contextInvoiceId) && this.matchesAny(normalized, ['cette facture', 'this invoice', 'had facture', 'هذه الفاتورة']);
    if (routedIntent.length > 0 && routedIntent[0]!.confidence < 0.7) {
      return {
        response: this.localized(language, {
          fr: 'Je ne suis pas certain de votre intention. Voulez-vous creer une facture, chercher un dossier ou lancer une analyse de risque ?',
          en: 'I am not fully sure about your intent. Do you want to create an invoice, search a record or run a risk analysis?',
          ar: 'لست متأكدا تماما من قصدك. هل تريد إنشاء فاتورة أو البحث عن سجل أو تشغيل تحليل مخاطر؟',
        }),
        intent: 'clarify_business_intent',
      };
    }

    if (routedIntent[0]?.name === 'create_customer') {
      const customerDraft = this.extractCustomerDraft(content);
      return {
        response: this.localized(language, {
          fr: customerDraft.name
            ? `J'ai prepare le brouillon du client ${customerDraft.name}. Completez les champs restants dans le formulaire pour generer la previsualisation.`
            : 'J ai compris la creation d un client. Completez le formulaire structure pour preparer la previsualisation.',
          en: customerDraft.name
            ? `I prepared the draft for customer ${customerDraft.name}. Complete the remaining fields in the form to generate the preview.`
            : 'I understood the customer creation request. Complete the structured form to prepare the preview.',
          ar: customerDraft.name
            ? `?? ????? ????? ?????? ${customerDraft.name}. ???? ?????? ???????? ?? ??????? ?????? ????????.`
            : '???? ??? ????? ????. ???? ??????? ?????? ?????? ????????.',
        }),
        intent: 'create_customer_form',
        toolCall: {
          name: 'create_customer',
          input: Object.fromEntries(
            Object.entries({
              name: customerDraft.name,
              email: customerDraft.email,
              country: customerDraft.country,
              countryCode: customerDraft.countryCode,
            }).filter(([, value]) => value != null)
          ),
        },
      };
    }

    if (routedIntent[0]?.name === 'create_product') {
      return {
        response: this.localized(language, {
          fr: 'J ai compris la creation d un produit. Completez le formulaire structure pour preparer la previsualisation.',
          en: 'I understood the product creation request. Complete the structured form to prepare the preview.',
          ar: '???? ??? ????? ???? ??????. ???? ??????? ?????? ?????? ????????.',
        }),
        intent: 'create_product_form',
        toolCall: {
          name: 'create_product',
          input: {},
        },
      };
    }

    const invoiceReference = contextInvoiceId
      ? { invoiceId: contextInvoiceId, invoiceReference: contextReference.invoiceReference }
      : invoiceNumber
        ? await this.resolveSingleInvoice(user, invoiceNumber).then((invoice) => invoice ? { invoiceId: invoice.id, invoiceReference: invoice.invoiceNumber } : null)
        : await this.resolveLatestInvoiceReference(user, conversationId);

    if (invoiceReference?.invoiceId && this.matchesAny(normalized, ['email', 'mail', 'envoie', 'envoyer', 'send'])) {
      return {
        response: this.localized(language, {
          fr: `J'ai retrouve ${invoiceReference.invoiceReference ?? contextInvoiceLabel}. Je prepare l'envoi email a confirmer avec le PDF joint du backend.`,
          en: `I found ${invoiceReference.invoiceReference ?? contextInvoiceLabel}. I am preparing the confirmation to send the email with the backend PDF attachment.`,
          ar: `عثرت على ${invoiceReference.invoiceReference ?? contextInvoiceLabel}. سأحضّر تأكيد إرسال البريد الإلكتروني مع ملف PDF من الخادم.`,
        }),
        intent: 'send_invoice_email',
        toolCall: { name: 'send_invoice_email', input: { invoiceId: invoiceReference.invoiceId } },
      };
    }

    if (invoiceReference?.invoiceId && this.matchesAny(normalized, ['tva', 'vat', 'tax']) && this.matchesAny(normalized, ['change', 'changer', 'set', 'mettre', 'update'])) {
      const taxRate = this.extractPercentValue(content);
      if (taxRate == null) {
        return {
          response: this.localized(language, {
            fr: 'Je peux changer la TVA de cette facture, mais il me faut le pourcentage exact, par exemple 0% ou 20%.',
            en: 'I can update the VAT on this invoice, but I need the exact percentage, for example 0% or 20%.',
            ar: 'يمكنني تعديل ضريبة القيمة المضافة لهذه الفاتورة، لكنني أحتاج النسبة الدقيقة مثل 0% أو 20%.',
          }),
          intent: 'clarify_invoice_tax',
        };
      }
      const payload = await this.getInvoiceUpdatePayload(user, invoiceReference.invoiceId);
      return {
        response: this.localized(language, {
          fr: `J'ai retrouve ${invoiceReference.invoiceReference ?? contextInvoiceLabel}. Je prepare une nouvelle previsualisation avec une TVA a ${taxRate}%.`,
          en: `I found ${invoiceReference.invoiceReference ?? contextInvoiceLabel}. I am preparing a new preview with VAT set to ${taxRate}%.`,
          ar: `عثرت على ${invoiceReference.invoiceReference ?? contextInvoiceLabel}. سأحضّر معاينة جديدة بضريبة قيمة مضافة ${taxRate}%.`,
        }),
        intent: 'update_invoice_tax',
        toolCall: { name: 'update_invoice', input: { ...payload, taxRate } },
      };
    }

    if (invoiceReference?.invoiceId && this.matchesAny(normalized, ['due date', 'echeance', 'échéance']) && this.matchesAny(normalized, ['change', 'changer', 'set', 'mettre', 'update'])) {
      const payload = await this.getInvoiceUpdatePayload(user, invoiceReference.invoiceId);
      const dueDate = this.extractDueDate(content, payload.dueDate);
      if (!dueDate) {
        return {
          response: this.localized(language, {
            fr: 'Je peux changer l’échéance de cette facture, mais il me faut une date précise ou une indication claire comme "le mois prochain".',
            en: 'I can update this invoice due date, but I need a precise date or a clear hint such as "next month".',
            ar: 'يمكنني تعديل تاريخ استحقاق هذه الفاتورة، لكنني أحتاج تاريخاً واضحاً أو إشارة مثل "الشهر القادم".',
          }),
          intent: 'clarify_invoice_due_date',
        };
      }
      return {
        response: this.localized(language, {
          fr: `J'ai retrouve ${invoiceReference.invoiceReference ?? contextInvoiceLabel}. Je prepare une nouvelle previsualisation avec l'échéance au ${dueDate}.`,
          en: `I found ${invoiceReference.invoiceReference ?? contextInvoiceLabel}. I am preparing a new preview with due date set to ${dueDate}.`,
          ar: `عثرت على ${invoiceReference.invoiceReference ?? contextInvoiceLabel}. سأحضّر معاينة جديدة بتاريخ استحقاق ${dueDate}.`,
        }),
        intent: 'update_invoice_due_date',
        toolCall: { name: 'update_invoice', input: { ...payload, dueDate } },
      };
    }

    if (invoiceReference?.invoiceId && this.matchesAny(normalized, ['ligne', 'line']) && this.matchesAny(normalized, ['ajoute', 'ajouter', 'add'])) {
      const payload = await this.getInvoiceUpdatePayload(user, invoiceReference.invoiceId);
      const quantity = this.extractHours(normalized) ?? 1;
      const unitPrice = this.extractMoneyValue(content) ?? 0;
      const description = this.extractLineDescription(content);
      if (!unitPrice) {
        return {
          response: this.localized(language, {
            fr: 'Je peux ajouter une ligne à cette facture, mais il me faut au moins le prix unitaire, par exemple 500 MAD.',
            en: 'I can add a line to this invoice, but I need at least the unit price, for example 500 MAD.',
            ar: 'يمكنني إضافة سطر إلى هذه الفاتورة، لكنني أحتاج على الأقل إلى السعر الوحدوي مثل 500 درهم.',
          }),
          intent: 'clarify_invoice_line_amount',
        };
      }
      return {
        response: this.localized(language, {
          fr: `J'ai retrouve ${invoiceReference.invoiceReference ?? contextInvoiceLabel}. Je prepare une nouvelle previsualisation avec une ligne "${description}" a ${unitPrice} MAD.`,
          en: `I found ${invoiceReference.invoiceReference ?? contextInvoiceLabel}. I am preparing a new preview with a "${description}" line at ${unitPrice} MAD.`,
          ar: `عثرت على ${invoiceReference.invoiceReference ?? contextInvoiceLabel}. سأحضّر معاينة جديدة مع سطر "${description}" بسعر ${unitPrice} درهم.`,
        }),
        intent: 'add_invoice_line',
        toolCall: {
          name: 'update_invoice',
          input: {
            ...payload,
            items: [
              ...payload.items,
              {
                description,
                unit: quantity > 1 ? 'heure' : null,
                quantity,
                unitPrice,
                taxRate: payload.taxRate,
              },
            ],
          },
        },
      };
    }

    if (invoiceReference?.invoiceId && this.matchesAny(normalized, ['ligne', 'line']) && this.matchesAny(normalized, ['supprime', 'supprimer', 'remove', 'delete'])) {
      const payload = await this.getInvoiceUpdatePayload(user, invoiceReference.invoiceId);
      const ordinalToRemove = this.extractOrdinal(normalized);
      if (!ordinalToRemove || ordinalToRemove < 1 || ordinalToRemove > payload.items.length) {
        return {
          response: this.localized(language, {
            fr: `Je peux supprimer une ligne de ${invoiceReference.invoiceReference ?? contextInvoiceLabel}, mais j'ai besoin du numéro de ligne, par exemple "supprime la deuxième ligne".`,
            en: `I can remove a line from ${invoiceReference.invoiceReference ?? contextInvoiceLabel}, but I need the line number, for example "remove the second line".`,
            ar: `يمكنني حذف سطر من ${invoiceReference.invoiceReference ?? contextInvoiceLabel}، لكنني أحتاج رقم السطر مثل "احذف السطر الثاني".`,
          }),
          intent: 'clarify_remove_invoice_line',
        };
      }
      return {
        response: this.localized(language, {
          fr: `J'ai retrouve ${invoiceReference.invoiceReference ?? contextInvoiceLabel}. Je prepare une nouvelle previsualisation sans la ligne ${ordinalToRemove}.`,
          en: `I found ${invoiceReference.invoiceReference ?? contextInvoiceLabel}. I am preparing a new preview without line ${ordinalToRemove}.`,
          ar: `عثرت على ${invoiceReference.invoiceReference ?? contextInvoiceLabel}. سأحضّر معاينة جديدة بدون السطر ${ordinalToRemove}.`,
        }),
        intent: 'remove_invoice_line',
        toolCall: {
          name: 'update_invoice',
          input: {
            ...payload,
            items: payload.items.filter((_, index) => index !== ordinalToRemove - 1),
          },
        },
      };
    }

    if (
      invoiceReference?.invoiceId
      && !pdfIntent
      && (
        refersToCurrentInvoice
        || invoiceNumber
        || this.matchesAny(normalized, ['ouvre cette facture', 'open this invoice', 'detail facture', 'details facture', 'invoice details'])
      )
    ) {
      return {
        response: this.localized(language, {
          fr: `J'ai retrouve ${invoiceReference.invoiceReference ?? contextInvoiceLabel}. J'ouvre ses détails métier.`,
          en: `I found ${invoiceReference.invoiceReference ?? contextInvoiceLabel}. I am opening its business details.`,
          ar: `عثرت على ${invoiceReference.invoiceReference ?? contextInvoiceLabel}. سأعرض تفاصيلها المهنية.`,
        }),
        intent: 'get_invoice_details',
        toolCall: { name: 'get_invoice_details', input: { invoiceId: invoiceReference.invoiceId } },
      };
    }
    if (routedIntent[0]?.name === 'create_invoice') {
      if (contextContractId) {
        const blockedPlan = await this.validateContractInvoiceIntent(user, language, contextContractId, contextContractLabel, true);
        if (blockedPlan) return blockedPlan;
        return {
          response: this.localized(language, {
            fr: `J ai trouve ${contextContractLabel}. Je prepare une creation de facture a confirmer avec les donnees facturables disponibles.`,
            en: `I found ${contextContractLabel}. I am preparing invoice creation for confirmation using available billable data.`,
            ar: `???? ??? ${contextContractLabel}. ???? ?????? ????? ???????? ??????? ???????? ???????? ??????? ??????? ???????.`,
          }),
          intent: 'contract_invoice_workflow',
          toolCall: { name: 'contract_invoice_workflow', input: { contractId: contextContractId } },
        };
      }
      const invoiceTarget = this.extractBusinessEntityQuery(content);
      if (invoiceTarget) {
        const client = await this.resolveSingleClient(user, invoiceTarget);
        if (client) {
          return {
            response: this.localized(language, {
              fr: `J ai retrouve le client ${client.name ?? invoiceTarget}. Completez les champs manquants dans le formulaire facture pour generer la previsualisation.`,
              en: `I found customer ${client.name ?? invoiceTarget}. Complete the missing fields in the invoice form to generate the preview.`,
              ar: `???? ??? ?????? ${client.name ?? invoiceTarget}. ???? ?????? ??????? ?? ????? ???????? ?????? ????????.`,
            }),
            intent: 'create_invoice_form',
            toolCall: { name: 'create_invoice', input: { customerId: client.id } },
          };
        }

        if (this.isExplicitContractInvoiceRequest(normalized, content)) {
          const contract = await this.resolveSingleContract(user, invoiceTarget);
          if (contract) {
            const blockedPlan = await this.validateContractInvoiceIntent(user, language, contract.id, contract.contractNumber, true);
            if (blockedPlan) return blockedPlan;
            return {
              response: this.localized(language, {
                fr: `J ai trouve le contrat ${contract.contractNumber ?? ''} lie a ${invoiceTarget}. Je prepare la facture a confirmer.`,
                en: `I found contract ${contract.contractNumber ?? ''} linked to ${invoiceTarget}. I am preparing the invoice for confirmation.`,
                ar: `???? ??? ????? ${contract.contractNumber ?? ''} ??????? ?? ${invoiceTarget}. ???? ?????? ???????? ???????.`,
              }),
              intent: 'contract_invoice_workflow',
              toolCall: { name: 'contract_invoice_workflow', input: { contractId: contract.id } },
            };
          }
        }

        return {
          response: this.localized(language, {
            fr: `Je n ai pas retrouve un client ou un contrat correspondant a ${invoiceTarget}. Donnez un nom client exact ou une reference de contrat comme CTR-2026-0001.`,
            en: `I could not find a matching customer or contract for ${invoiceTarget}. Give me the exact customer name or a contract reference like CTR-2026-0001.`,
            ar: `?? ??? ?????? ?? ????? ??????? ?? ${invoiceTarget}. ????? ??? ?????? ?????? ?? ???? ??? ??? CTR-2026-0001.`,
          }),
          intent: 'clarify_create_invoice',
        };
      }
      return {
        response: this.localized(language, {
          fr: 'Je prepare le formulaire de creation de facture. Selectionnez le client et completez les informations requises pour generer la previsualisation.',
          en: 'I am preparing the invoice creation form. Select the customer and complete the required information to generate the preview.',
          ar: '???? ?????? ????? ????? ????????. ???? ?????? ????? ????????? ???????? ?????? ????????.',
        }),
        intent: 'create_invoice_form',
        toolCall: { name: 'create_invoice', input: {} },
      };
    }

    if (routedIntent[0]?.name === 'generate_pdf') {
      const invoiceReferenceForPdf = contextInvoiceId
        ? { invoiceId: contextInvoiceId, invoiceReference: contextReference.invoiceReference }
        : await this.resolveLatestInvoiceReference(user, conversationId);
      if (!invoiceReferenceForPdf?.invoiceId) {
        return {
          response: this.localized(language, {
            fr: 'Je peux generer un PDF, mais je dois savoir quelle facture utiliser. Donnez une reference comme INV-2026.',
            en: 'I can generate a PDF, but I need to know which invoice to use. Give me a reference like INV-2026.',
            ar: 'يمكنني إنشاء PDF، لكن يجب أن أعرف أي فاتورة أستخدم. أعطني مرجعا مثل INV-2026.',
          }),
          intent: 'clarify_generate_pdf',
        };
      }
      return {
        response: this.localized(language, {
          fr: 'Je prepare les informations PDF de cette facture.',
          en: 'I am preparing PDF information for this invoice.',
          ar: 'سأحضر معلومات PDF لهذه الفاتورة.',
        }),
        intent: 'generate_invoice_pdf',
        toolCall: { name: 'generate_invoice_pdf', input: { invoiceId: invoiceReferenceForPdf.invoiceId } },
      };
    }

    if (routedIntent[0]?.name === 'payment') {
      return {
        response: this.localized(language, {
          fr: 'Je peux rechercher les paiements ou enregistrer un paiement si vous precisez la facture, le montant, la date et le mode de paiement.',
          en: 'I can search payments or record a payment if you provide the invoice, amount, date and payment method.',
          ar: 'يمكنني البحث عن الدفعات أو تسجيل دفعة إذا قدمت الفاتورة والمبلغ والتاريخ وطريقة الدفع.',
        }),
        intent: 'payment_tools_available',
      };
    }

    if (routedIntent[0]?.name === 'reports') {
      return {
        response: this.localized(language, {
          fr: 'Je prepare les rapports financiers accessibles selon vos permissions.',
          en: 'I am preparing the financial reports available under your permissions.',
          ar: 'أحضر التقارير المالية المتاحة حسب صلاحياتك.',
        }),
        intent: 'receivables_report',
        toolCall: { name: 'get_receivables_aging_report', input: {} },
      };
    }

    if (routedIntent[0]?.name === 'create_quote') {
      const quoteTarget = this.extractBusinessEntityQuery(content);
      const customer = quoteTarget ? await this.resolveSingleClient(user, quoteTarget) : null;
      return {
        response: this.localized(language, {
          fr: customer
            ? `J ai retrouve le client ${customer.name ?? quoteTarget}. Completez le formulaire devis pour generer la previsualisation.`
            : 'Je prepare le formulaire de creation de devis. Completez les informations requises pour generer la previsualisation.',
          en: customer
            ? `I found customer ${customer.name ?? quoteTarget}. Complete the quote form to generate the preview.`
            : 'I am preparing the quote creation form. Complete the required information to generate the preview.',
          ar: customer
            ? `???? ??? ?????? ${customer.name ?? quoteTarget}. ???? ????? ??? ????? ?????? ????????.`
            : '???? ?????? ????? ????? ??? ?????. ???? ????????? ???????? ?????? ????????.',
        }),
        intent: 'create_quote_form',
        toolCall: { name: 'create_quote', input: customer ? { customerId: customer.id } : {} },
      };
    }

    if (false) {
      return {
        response: this.localized(language, {
          fr: 'J ai compris l intention, mais ce workflow n est pas encore expose comme action outillee dans l assistant. Je peux continuer avec les actions disponibles si vous precisez le dossier.',
          en: 'I understood the intent, but this workflow is not yet exposed as an assistant tool action. I can continue with available actions if you specify the record.',
          ar: 'فهمت القصد، لكن هذا المسار غير متاح بعد كأداة داخل المساعد. يمكنني المتابعة بالإجراءات المتاحة إذا حددت السجل.',
        }),
        intent: 'legacy_tools_available',
      };
    }

    if (routedIntent[0]?.name === 'approval_center') {
      return {
        response: this.localized(language, {
          fr: 'Je rassemble les validations en attente accessibles selon vos permissions.',
          en: 'I am gathering pending approvals available under your permissions.',
          ar: 'سأجمع الموافقات المعلقة المتاحة حسب صلاحياتك.',
        }),
        intent: 'approval_center',
        toolCall: { name: 'list_approval_center', input: { limit: 20 } },
      };
    }

    if (routedIntent[0]?.name === 'executive_briefing') {
      return {
        response: this.localized(language, {
          fr: 'Je prepare un briefing executif avec les alertes, revenus, approbations et recommandations prioritaires.',
          en: 'I am preparing an executive briefing with alerts, revenue, approvals and priority recommendations.',
          ar: 'سأحضر موجزا تنفيذيا يتضمن التنبيهات والإيرادات والموافقات والتوصيات ذات الأولوية.',
        }),
        intent: 'executive_briefing',
        toolCall: { name: 'get_executive_briefing', input: { limit: 10 } },
      };
    }

    if (routedIntent[0]?.name === 'contract_risk') {
      return {
        response: this.localized(language, {
          fr: contextContractId ? `J analyse la sante et les risques de ${contextContractLabel}.` : 'J analyse les contrats a risque et ceux qui demandent une attention prioritaire.',
          en: contextContractId ? `I am analyzing health and risks for ${contextContractLabel}.` : 'I am analyzing risky contracts and contracts that require priority attention.',
          ar: contextContractId ? `سأحلل صحة ومخاطر ${contextContractLabel}.` : 'سأحلل العقود عالية المخاطر والعقود التي تحتاج إلى اهتمام عاجل.',
        }),
        intent: 'contract_health',
        toolCall: { name: 'analyze_contract_health', input: contextContractId ? { contractId: contextContractId, limit: 10 } : { limit: 10 } },
      };
    }

    if (routedIntent[0]?.name === 'customer_risk') {
      return {
        response: this.localized(language, {
          fr: 'J analyse les clients a risque avec les retards, soldes ouverts et signaux commerciaux.',
          en: 'I am analyzing risky customers using overdue invoices, open balance and commercial signals.',
          ar: 'سأحلل العملاء ذوي المخاطر حسب الفواتير المتأخرة والرصيد المفتوح والمؤشرات التجارية.',
        }),
        intent: 'customer_health',
        toolCall: { name: 'analyze_customer_health', input: contextReference.clientId ? { customerId: contextReference.clientId, limit: 10 } : { limit: 10 } },
      };
    }

    const shouldDeferInvoiceRecommendationToContractContext = routedIntent[0]?.name === 'invoice_recommendations'
      && Boolean(contextContractId)
      && timesheetIntent
      && !invoiceIntent;
    if (!shouldDeferInvoiceRecommendationToContractContext && (routedIntent[0]?.name === 'overdue_invoices' || routedIntent[0]?.name === 'invoice_recommendations')) {
      return {
        response: this.localized(language, {
          fr: routedIntent[0].name === 'invoice_recommendations'
            ? 'J analyse les feuilles approuvees pretes a facturer et la valeur estimative a convertir en factures.'
            : 'J analyse les factures en retard, le risque de recouvrement et les priorites de relance.',
          en: routedIntent[0].name === 'invoice_recommendations'
            ? 'I am analyzing approved billable time and estimated value ready to convert into invoices.'
            : 'I am analyzing overdue invoices, collection exposure and follow-up priorities.',
          ar: routedIntent[0].name === 'invoice_recommendations'
            ? 'سأحلل الوقت المعتمد القابل للفوترة والقيمة التقديرية الجاهزة للتحويل إلى فواتير.'
            : 'سأحلل الفواتير المتأخرة ومخاطر التحصيل وأولويات المتابعة.',
        }),
        intent: routedIntent[0].name === 'invoice_recommendations' ? 'invoice_recommendations' : 'overdue_invoices',
        toolCall: { name: 'analyze_revenue_intelligence', input: {} },
      };
    }

    if (approvalCenterIntent) {
      return {
        response: this.localized(language, {
          fr: 'Je rassemble les validations en attente accessibles selon vos permissions.',
          en: 'I am gathering pending approvals available under your permissions.',
          ar: 'سأجمع الموافقات المعلقة المتاحة حسب صلاحياتك.',
        }),
        intent: 'approval_center',
        toolCall: { name: 'list_approval_center', input: { limit: 20 } },
      };
    }

    if (executiveBriefingIntent) {
      return {
        response: this.localized(language, {
          fr: 'Je prepare un briefing executif avec les alertes, revenus, approbations et recommandations prioritaires.',
          en: 'I am preparing an executive briefing with alerts, revenue, approvals and priority recommendations.',
          ar: 'سأحضر موجزا تنفيذيا يتضمن التنبيهات والإيرادات والموافقات والتوصيات ذات الأولوية.',
        }),
        intent: 'executive_briefing',
        toolCall: { name: 'get_executive_briefing', input: { limit: 10 } },
      };
    }

    if (contractHealthIntent) {
      return {
        response: this.localized(language, {
          fr: contextContractId ? `J analyse la sante et les risques de ${contextContractLabel}.` : 'J analyse les contrats qui demandent le plus d attention.',
          en: contextContractId ? `I am analyzing health and risks for ${contextContractLabel}.` : 'I am analyzing the contracts that need the most attention.',
          ar: contextContractId ? `سأحلل صحة ومخاطر ${contextContractLabel}.` : 'سأحلل العقود التي تحتاج إلى أكبر قدر من الاهتمام.',
        }),
        intent: 'contract_health',
        toolCall: { name: 'analyze_contract_health', input: contextContractId ? { contractId: contextContractId, limit: 10 } : { limit: 10 } },
      };
    }

    if (customerHealthIntent) {
      return {
        response: this.localized(language, {
          fr: 'J analyse les clients les plus sensibles avec retard, solde ouvert et risque commercial.',
          en: 'I am analyzing the most sensitive customers using overdue invoices, open balance and commercial risk.',
          ar: 'سأحلل العملاء الأكثر حساسية حسب الفواتير المتأخرة والرصيد المفتوح والمخاطر التجارية.',
        }),
        intent: 'customer_health',
        toolCall: { name: 'analyze_customer_health', input: contextReference.clientId ? { customerId: contextReference.clientId, limit: 10 } : { limit: 10 } },
      };
    }

    if (revenueInsightIntent) {
      return {
        response: this.localized(language, {
          fr: 'J analyse les revenus, les factures en retard et le chiffre pret a facturer.',
          en: 'I am analyzing revenue, overdue invoices and ready-to-invoice value.',
          ar: 'سأحلل الإيرادات والفواتير المتأخرة والقيمة الجاهزة للفوترة.',
        }),
        intent: 'revenue_intelligence',
        toolCall: { name: 'analyze_revenue_intelligence', input: {} },
      };
    }

    const ordinal = this.extractOrdinal(normalized);

    if (ordinal) {
      const ordinalReference = await this.resolveOrdinalReference(user, conversationId, ordinal);
      if (ordinalReference?.contractId) {
        return {
          response: this.localized(language, {
            fr: `J ai retrouve ${ordinalReference.contractReference ?? 'ce contrat'} dans le resultat precedent.`,
            en: `I found ${ordinalReference.contractReference ?? 'that contract'} in the previous result.`,
            ar: `وجدت ${ordinalReference.contractReference ?? 'ذلك العقد'} في النتيجة السابقة.`,
          }),
          intent: 'get_contract_details',
          toolCall: { name: 'get_contract_details', input: { contractId: ordinalReference.contractId } },
        };
      }
      if (ordinalReference?.invoiceId) {
        return {
          response: this.localized(language, {
            fr: `J ai retrouve ${ordinalReference.invoiceReference ?? 'cette facture'} dans le resultat precedent.`,
            en: `I found ${ordinalReference.invoiceReference ?? 'that invoice'} in the previous result.`,
            ar: `وجدت ${ordinalReference.invoiceReference ?? 'تلك الفاتورة'} في النتيجة السابقة.`,
          }),
          intent: 'get_invoice_details',
          toolCall: { name: 'get_invoice_details', input: { invoiceId: ordinalReference.invoiceId } },
        };
      }
    }

    if (!contextContractId && contextReference.clientReference && (invoiceIntent || timesheetIntent || this.matchesAny(normalized, ['contrat', 'contract']))) {
      const contract = await this.resolveSingleContract(user, contextReference.clientReference);
      if (contract) {
        const isWrite = invoiceIntent && this.matchesAny(normalized, ['cree', 'creer', 'genere', 'generer', 'create', 'generate']);
        if (invoiceIntent) {
          const blockedPlan = await this.validateContractInvoiceIntent(user, language, contract.id, contract.contractNumber, isWrite);
          if (blockedPlan) return blockedPlan;
        }
        return {
          response: this.localized(language, {
            fr: `J ai trouve un contrat lie a ${contextReference.clientReference}. Je continue avec ${contract.contractNumber ?? 'ce contrat'}.`,
            en: `I found one contract linked to ${contextReference.clientReference}. I will continue with ${contract.contractNumber ?? 'that contract'}.`,
            ar: `وجدت عقدا مرتبطا ب ${contextReference.clientReference}. سأتابع مع ${contract.contractNumber ?? 'هذا العقد'}.`,
          }),
          intent: invoiceIntent ? (isWrite ? 'contract_invoice_workflow' : 'prepare_invoice_preview') : 'get_contract_details',
          toolCall: {
            name: invoiceIntent ? (isWrite ? 'contract_invoice_workflow' : 'prepare_invoice_preview') : 'get_contract_details',
            input: { contractId: contract.id },
          },
        };
      }
      return {
        response: this.localized(language, {
          fr: `Je cherche les contrats accessibles lies a ${contextReference.clientReference}.`,
          en: `I am searching accessible contracts linked to ${contextReference.clientReference}.`,
          ar: `سأبحث عن العقود المسموح بها المرتبطة ب ${contextReference.clientReference}.`,
        }),
        intent: 'search_contracts',
        toolCall: { name: 'search_contracts', input: { query: contextReference.clientReference, limit: 5 } },
      };
    }

    if (contextContractId && (refersToCurrentContract || (!contractNumber && consumptionIntent))) {
      return {
        response: this.localized(language, {
          fr: `J ai trouve ${contextContractLabel}. Je consulte sa consommation.`,
          en: `I found ${contextContractLabel}. I am checking its consumption.`,
          ar: `وجدت ${contextContractLabel}. سأعرض استهلاكه.`,
        }),
        intent: 'view_contract_consumption',
        toolCall: { name: 'get_contract_consumption', input: { contractId: contextContractId } },
      };
    }

    if (contextContractId && (refersToCurrentContract || (!contractNumber && timesheetIntent))) {
      const timesheetInput: Record<string, unknown> = { contractId: contextContractId };
      if (approvedIntent) timesheetInput.status = 'APPROVED';
      if (todayIntent) timesheetInput.workDate = new Date().toISOString().slice(0, 10);
      return {
        response: this.localized(language, {
          fr: `J ai trouve ${contextContractLabel}. Je consulte les feuilles de temps correspondantes.`,
          en: `I found ${contextContractLabel}. I am showing the matching timesheets.`,
          ar: `وجدت ${contextContractLabel}. سأعرض سجلات الوقت المطابقة.`,
        }),
        intent: 'list_timesheets',
        toolCall: { name: 'list_timesheets', input: timesheetInput },
      };
    }

    if (contextContractId && (refersToCurrentContract || (!contractNumber && invoiceIntent))) {
      const isWrite = this.matchesAny(normalized, ['cree', 'creer', 'genere', 'generer', 'create', 'generate']);
      const blockedPlan = await this.validateContractInvoiceIntent(user, language, contextContractId, contextContractLabel, isWrite);
      if (blockedPlan) return blockedPlan;
      return {
        response: isWrite
          ? this.localized(language, {
            fr: `J ai trouve ${contextContractLabel}. Je calcule les feuilles approuvees, la periode, les taxes et je prepare une creation de facture a confirmer.`,
            en: `I found ${contextContractLabel}. I am calculating approved timesheets, the billing period and taxes, then preparing an invoice preview for confirmation.`,
            ar: `وجدت ${contextContractLabel}. سأحسب سجلات الوقت المعتمدة والفترة والضرائب ثم أحضر معاينة إنشاء الفاتورة للتأكيد.`,
          })
          : this.localized(language, {
            fr: `J ai trouve ${contextContractLabel}. Je prepare un apercu complet de facture avec les heures, le taux, la TVA et le total estime.`,
            en: `I found ${contextContractLabel}. I am preparing a complete invoice preview with hours, rate, VAT and estimated total.`,
            ar: `وجدت ${contextContractLabel}. سأحضر معاينة كاملة للفاتورة تشمل الساعات والسعر والضريبة والمجموع التقديري.`,
          }),
        intent: isWrite ? 'contract_invoice_workflow' : 'prepare_invoice_preview',
        toolCall: { name: isWrite ? 'contract_invoice_workflow' : 'prepare_invoice_preview', input: { contractId: contextContractId } },
      };
    }

    if (contextInvoiceId && (refersToCurrentInvoice || (!invoiceNumber && pdfIntent))) {
      return {
        response: this.localized(language, {
          fr: 'Je prepare les informations PDF de cette facture.',
          en: 'I am preparing PDF information for this invoice.',
          ar: 'سأحضر معلومات PDF لهذه الفاتورة.',
        }),
        intent: 'generate_invoice_pdf',
        toolCall: { name: 'generate_invoice_pdf', input: { invoiceId: contextInvoiceId } },
      };
    }

    if (contextContractId && refersToCurrentContract && this.matchesAny(normalized, ['consommation', 'budget', 'reste', 'remaining', 'consumption', 'ch7al', 'ba9i'])) {
      return {
        response: this.localized(language, {
          fr: 'Je consulte la consommation de ce contrat.',
          en: 'I am checking consumption for this contract.',
          ar: 'سأعرض استهلاك هذا العقد.',
        }),
        intent: 'view_contract_consumption',
        toolCall: { name: 'get_contract_consumption', input: { contractId: contextContractId } },
      };
    }

    if (contextContractId && refersToCurrentContract && this.matchesAny(normalized, ['timesheet', 'feuille', 'temps', 'time'])) {
      return {
        response: this.localized(language, {
          fr: 'Je consulte les feuilles de temps de ce contrat.',
          en: 'I am showing timesheets for this contract.',
          ar: 'سأعرض سجلات الوقت لهذا العقد.',
        }),
        intent: 'list_timesheets',
        toolCall: { name: 'list_timesheets', input: { contractId: contextContractId } },
      };
    }

    if (contractNumber && this.matchesAny(normalized, ['consommation', 'budget', 'reste', 'remaining', 'consumption', 'ch7al', 'ba9i'])) {
      const contract = await this.resolveSingleContract(user, contractNumber);
      if (!contract) {
        return {
          response: this.localized(language, {
            fr: `Je n ai trouve aucun contrat correspondant a ${contractNumber}.`,
            en: `I could not find a contract matching ${contractNumber}.`,
            ar: `لم أجد عقدا يطابق ${contractNumber}.`,
          }),
          intent: 'contract_not_found',
        };
      }
      return {
        response: this.localized(language, {
          fr: `Je consulte la consommation du contrat ${contractNumber}.`,
          en: `I am checking consumption for contract ${contractNumber}.`,
          ar: `سأعرض استهلاك العقد ${contractNumber}.`,
        }),
        intent: 'view_contract_consumption',
        toolCall: { name: 'get_contract_consumption', input: { contractId: contract.id } },
      };
    }

    if (contractNumber && this.matchesAny(normalized, ['timesheet', 'feuille', 'temps', 'time'])) {
      const contract = await this.resolveSingleContract(user, contractNumber);
      if (!contract) {
        return {
          response: this.localized(language, {
            fr: `Je n ai trouve aucun contrat correspondant a ${contractNumber}.`,
            en: `I could not find a contract matching ${contractNumber}.`,
            ar: `لم أجد عقدا يطابق ${contractNumber}.`,
          }),
          intent: 'contract_not_found',
        };
      }
      if (this.matchesAny(normalized, ['cree', 'creer', 'create', 'sawb', 'ajoute', 'add'])) {
        const hours = this.extractHours(normalized) ?? 1;
        const activity = this.extractActivity(content) ?? 'Support';
        return {
          response: this.localized(language, {
            fr: `Je prepare une feuille de temps de ${hours} h pour ${contract.contractNumber}.`,
            en: `I am preparing a ${hours} h timesheet for ${contract.contractNumber}.`,
            ar: `سأحضر سجل وقت مدته ${hours} ساعة للعقد ${contract.contractNumber}.`,
          }),
          intent: 'create_timesheet',
          toolCall: {
            name: 'create_timesheet',
            input: {
              contractId: contract.id,
              workDate: new Date().toISOString().slice(0, 10),
              quantity: hours,
              activityType: activity,
              description: `${activity} - ${hours}h`,
              billable: true,
            },
          },
        };
      }
      if (this.matchesAny(normalized, ['pret', 'pretes', 'facturer', 'ready', 'invoice'])) {
        return {
          response: this.localized(language, {
            fr: `Je cherche les feuilles de temps pretes a facturer pour ${contract.contractNumber}.`,
            en: `I am looking for timesheets ready to invoice for ${contract.contractNumber}.`,
            ar: `سأبحث عن سجلات الوقت الجاهزة للفوترة للعقد ${contract.contractNumber}.`,
          }),
          intent: 'list_ready_to_invoice',
          toolCall: { name: 'list_ready_to_invoice', input: { contractId: contract.id } },
        };
      }
      return {
        response: this.localized(language, {
          fr: `Je consulte les feuilles de temps du contrat ${contract.contractNumber}.`,
          en: `I am showing timesheets for contract ${contract.contractNumber}.`,
          ar: `سأعرض سجلات الوقت للعقد ${contract.contractNumber}.`,
        }),
        intent: 'list_timesheets',
        toolCall: { name: 'list_timesheets', input: { contractId: contract.id } },
      };
    }

    if (contractNumber && this.matchesAny(normalized, ['facture', 'invoice', 'prepare', 'prepare', 'genere', 'generate'])) {
      const contract = await this.resolveSingleContract(user, contractNumber);
      if (contract) {
        const isWrite = this.matchesAny(normalized, ['cree', 'creer', 'genere', 'generer', 'create', 'generate']);
        const blockedPlan = await this.validateContractInvoiceIntent(user, language, contract.id, contract.contractNumber, isWrite);
        if (blockedPlan) return blockedPlan;
        return {
          response: isWrite
            ? this.localized(language, {
              fr: `Je prepare la creation de facture pour ${contract.contractNumber}.`,
              en: `I am preparing invoice creation for ${contract.contractNumber}.`,
              ar: `سأحضر إنشاء فاتورة للعقد ${contract.contractNumber}.`,
            })
            : this.localized(language, {
              fr: `Je prepare un apercu de facture pour ${contract.contractNumber}.`,
              en: `I am preparing an invoice preview for ${contract.contractNumber}.`,
              ar: `سأحضر معاينة فاتورة للعقد ${contract.contractNumber}.`,
            }),
          intent: isWrite ? 'contract_invoice_workflow' : 'prepare_invoice_preview',
          toolCall: { name: isWrite ? 'contract_invoice_workflow' : 'prepare_invoice_preview', input: { contractId: contract.id } },
        };
      }
    }

    if (contractNumber) {
      return {
        response: this.localized(language, {
          fr: `Je cherche le contrat ${contractNumber}.`,
          en: `I am searching for contract ${contractNumber}.`,
          ar: `سأبحث عن العقد ${contractNumber}.`,
        }),
        intent: 'search_contracts',
        toolCall: { name: 'search_contracts', input: { query: contractNumber, limit: 5 } },
      };
    }

    if (invoiceNumber) {
      return {
        response: this.localized(language, {
          fr: `Je cherche la facture ${invoiceNumber}.`,
          en: `I am searching for invoice ${invoiceNumber}.`,
          ar: `سأبحث عن الفاتورة ${invoiceNumber}.`,
        }),
        intent: 'search_invoices',
        toolCall: { name: 'search_invoices', input: { search: invoiceNumber, limit: '5', page: '1' } },
      };
    }

    if (this.matchesAny(normalized, ['contrat', 'contract', '3aqd', 'عقد'])) {
      const query = this.extractSearchQuery(content);
      if (!query || !this.isSpecificEntitySearchQuery(query)) {
        return {
          response: this.localized(language, {
            fr: 'Voulez-vous voir les contrats a risque, les contrats qui expirent ou rechercher un contrat precis ? Donnez une reference comme CTR-2026 ou un nom client.',
            en: 'Do you want risky contracts, expiring contracts or a specific contract search? Give me a reference like CTR-2026 or a customer name.',
            ar: 'هل تريد العقود عالية المخاطر أو العقود التي تنتهي قريبا أو البحث عن عقد محدد؟ أعطني مرجعا مثل CTR-2026 أو اسم عميل.',
          }),
          intent: 'clarify_contract_intent',
        };
      }
      return {
        response: this.localized(language, {
          fr: `Je recherche les contrats correspondant a "${query}".`,
          en: `I am searching contracts matching "${query}".`,
          ar: `سأبحث عن العقود المطابقة لـ "${query}".`,
        }),
        intent: 'search_contracts',
        toolCall: { name: 'search_contracts', input: { query, limit: 5 } },
      };
    }

    if (this.matchesAny(normalized, ['client', 'customer'])) {
      const query = this.extractSearchQuery(content);
      if (!query || !this.isSpecificEntitySearchQuery(query)) {
        return {
          response: this.localized(language, {
            fr: 'Voulez-vous analyser les clients a risque ou rechercher un client precis ? Donnez un nom, une societe ou une adresse email.',
            en: 'Do you want customer risk analysis or a specific customer search? Give me a name, company or email address.',
            ar: 'هل تريد تحليل العملاء ذوي المخاطر أو البحث عن عميل محدد؟ أعطني اسما أو شركة أو بريدا إلكترونيا.',
          }),
          intent: 'clarify_customer_intent',
        };
      }
      return {
        response: this.localized(language, {
          fr: `Je recherche les clients correspondant a "${query}".`,
          en: `I am searching clients matching "${query}".`,
          ar: `سأبحث عن العملاء المطابقين لـ "${query}".`,
        }),
        intent: 'search_clients',
        toolCall: { name: 'search_clients', input: { query, limit: 5 } },
      };
    }
    return null;
  }

  /** Part of the keyword fallback system (see `keywordFallbackPlan`) — not authoritative. */
  private scoreAssistantIntent(normalized: string): DetectedAssistantIntent[] {
    const scores = new Map<AssistantIntentName, number>();
    const setScore = (name: AssistantIntentName, score: number) => {
      scores.set(name, Math.min(0.99, Math.max(scores.get(name) ?? 0, score)));
    };
    const addScore = (name: AssistantIntentName, score: number) => {
      scores.set(name, Math.min(0.99, (scores.get(name) ?? 0) + score));
    };
    const hasCreate = this.matchesAny(normalized, [
      'create',
      'prepare',
      'generate',
      'make',
      'draft',
      'cree',
      'creer',
      'preparer',
      'prepare',
      'genere',
      'generer',
      'etablir',
      'facture ce',
      'invoice this',
      'bill this',
      'sawb',
      'dir',
    ]);
    const hasInvoice = this.matchesAny(normalized, ['invoice', 'invoices', 'facture', 'factures', 'billing', 'bill']);
    const hasQuote = this.matchesAny(normalized, ['quote', 'quotes', 'quotation', 'estimate', 'devis']);
    const hasPdf = this.matchesAny(normalized, ['pdf', 'download pdf', 'telecharger pdf', 'telecharge pdf', 'apercu pdf', 'print pdf', 'imprimer pdf']);
    const hasTimesheet = this.matchesAny(normalized, ['timesheet', 'timesheets', 'time sheet', 'feuille de temps', 'feuilles de temps', 'temps billable']);
    const hasPayment = this.matchesAny(normalized, ['payment', 'payments', 'paiement', 'paiements', 'paid', 'paye', 'payee', 'encaissement']);
    const hasContract = this.matchesAny(normalized, ['contract', 'contracts', 'contrat', 'contrats']);
    const hasCustomer = this.matchesAny(normalized, ['customer', 'customers', 'client', 'clients']);
    const hasStrongCustomerCreationIntent =
      hasCustomer
      && this.matchesAny(normalized, [
        'create a client',
        'create client',
        'create a customer',
        'create customer',
        'customer named',
        'customer called',
        'client named',
        'client called',
        'add a new client',
        'add new client',
        'add a client',
        'add a customer',
        'new client',
        'new customer',
        'cree un client',
        'creer un client',
        'cree une cliente',
        'creer une cliente',
        'ajoute un client',
        'ajouter un client',
        'ajoute un nouveau client',
        'ajouter un nouveau client',
        'nouveau client',
        'sawb lia client',
        'zid client',
        'zid client jdid',
        'client smito',
      ]);
    const hasReport = this.matchesAny(normalized, ['report', 'reports', 'rapport', 'rapports', 'analytics', 'statistiques']);
    const hasRisk = this.matchesAny(normalized, [
      'risk',
      'risky',
      'at risk',
      'danger',
      'attention',
      'requiring attention',
      'requires attention',
      'need attention',
      'needs attention',
      'critical',
      'high priority',
      'risque',
      'a risque',
      'a surveiller',
      'prioritaire',
      'critique',
      'expiring',
      'expiration',
      'over budget',
    ]);
    const hasOverdue = this.matchesAny(normalized, [
      'overdue',
      'late invoice',
      'late invoices',
      'unpaid invoice',
      'unpaid invoices',
      'past due',
      'factures en retard',
      'facture en retard',
      'impaye',
      'impayes',
      'en retard',
      'recouvrement',
    ]);
    const hasInvoiceRecommendation = this.matchesAny(normalized, [
      'what should i invoice',
      'what to invoice',
      'invoice today',
      'bill today',
      'ready to invoice',
      'ready-to-invoice',
      'unbilled',
      'approved timesheets',
      'approved billable',
      'que dois je facturer',
      'quoi facturer',
      'pret a facturer',
      'prets a facturer',
      'pretes a facturer',
      'facturer aujourd hui',
      'facturer aujourdhui',
    ]);

    const hasProduct = this.matchesAny(normalized, ['product', 'products', 'produit', 'produits', 'catalogue', 'item', 'items', 'sku']);

    if (hasStrongCustomerCreationIntent) setScore('create_customer', 0.97);
    if (hasCreate && hasInvoice && !hasPdf) setScore('create_invoice', 0.97);
    if (hasCreate && hasProduct && !hasInvoice) setScore('create_product', 0.95);
    const hasStrongInvoiceCreationIntent =
  !hasPdf &&
  (
    (hasCreate && hasInvoice) ||
    this.matchesAny(normalized, [
      'facture pour',
      'facture ce client',
      'facture ce contrat',
      'invoice for',
      'invoice this client',
      'invoice this contract',
      'create invoice',
      'create an invoice',
      'creer une facture',
      'créer une facture',
      'prepare une facture',
      'prépare une facture',
    ])
  );
    if (!hasPdf && this.matchesAny(normalized, ['facture pour', 'facture ce client', 'facture ce contrat', 'invoice for', 'invoice this customer', 'invoice this contract', 'bill for'])) {
      setScore('create_invoice', 0.98);
    }
    if (hasCreate && hasQuote) setScore('create_quote', 0.95);
    if (hasPdf) setScore('generate_pdf', 0.94);
    if (hasTimesheet) setScore('timesheet', hasCreate ? 0.93 : 0.82);
    if (hasPayment) setScore('payment', 0.86);
    if (!hasStrongInvoiceCreationIntent && hasContract && !hasRisk && !hasCreate) {
  setScore('contract', 0.72);
}
    if (!hasStrongInvoiceCreationIntent && hasCustomer && !hasRisk && !hasCreate) {
  setScore('customer', 0.72);
}
    if (hasReport) setScore('reports', 0.78);
    if (!hasStrongInvoiceCreationIntent && hasContract && hasRisk && !hasCreate) {
  setScore('contract_risk', 0.92);
}
    if (!hasStrongInvoiceCreationIntent && hasCustomer && hasRisk && !hasCreate) {
  setScore('customer_risk', 0.92);
}
    if (hasInvoice && hasOverdue && !hasCreate) setScore('overdue_invoices', 0.94);
    if (hasInvoiceRecommendation) setScore('invoice_recommendations', 0.96);
    if (this.matchesAny(normalized, ['approval center', 'approvals', 'approbations', 'pending approvals', 'pending actions', 'actions en attente'])) {
      setScore('approval_center', 0.95);
    }
    if (this.matchesAny(normalized, ['executive briefing', 'executive summary', 'briefing', 'business briefing', 'resume executif', 'vue executive'])) {
      setScore('executive_briefing', 0.95);
    }

    if (!hasPdf && hasCreate && hasContract) addScore('create_invoice', 0.04);

    const priority: AssistantIntentName[] = [
      'create_customer',
      'create_invoice',
      'create_product',
      'create_quote',
      'generate_pdf',
      'timesheet',
      'payment',
      'contract',
      'customer',
      'reports',
      'search',
      'contract_risk',
      'customer_risk',
      'overdue_invoices',
      'invoice_recommendations',
      'approval_center',
      'executive_briefing',
    ];
    return Array.from(scores.entries())
      .map(([name, confidence]) => ({ name, confidence }))
      .sort((left, right) => right.confidence - left.confidence || priority.indexOf(left.name) - priority.indexOf(right.name));
  }

  /** Part of the keyword fallback system (see `keywordFallbackPlan`) — not authoritative. */
  private detectAssistantIntent(normalized: string): DetectedAssistantIntent[] {
    const prioritizedIntent = this.scoreAssistantIntent(normalized);
    if (prioritizedIntent.length > 0) return prioritizedIntent;

    const candidates: DetectedAssistantIntent[] = [];
    const hasContract = this.matchesAny(normalized, ['contract', 'contracts', 'contrat', 'contrats', '3aqd', 'عقد', 'عقود']);
    const hasCustomer = this.matchesAny(normalized, ['customer', 'customers', 'client', 'clients', 'custmer', 'زبون', 'عميل', 'عملاء']);
    const hasInvoice = this.matchesAny(normalized, ['invoice', 'invoices', 'facture', 'factures', 'billing', 'fawatir', 'فاتورة', 'فواتير']);
    const hasRisk = this.matchesAny(normalized, [
      'risk',
      'risky',
      'at risk',
      'high risk',
      'danger',
      'attention',
      'requiring attention',
      'requires attention',
      'need attention',
      'needs attention',
      'critical',
      'high priority',
      'prioritaire',
      'critique',
      'risque',
      'risques',
      'a risque',
      'a surveiller',
      'surveiller',
      'expiring',
      'expire',
      'expiration',
      'renewal',
      'renewals',
      'renouvellement',
      'renouveler',
      'close to expiration',
      'near expiry',
      'over budget',
      'budget exceeded',
      'depasse budget',
      'dépasse budget',
    ]);
    const hasOverdue = this.matchesAny(normalized, [
      'overdue',
      'late invoice',
      'late invoices',
      'unpaid invoice',
      'unpaid invoices',
      'past due',
      'payment delay',
      'collection',
      'factures en retard',
      'facture en retard',
      'impaye',
      'impayes',
      'impayee',
      'impayees',
      'en retard',
      'retard paiement',
      'recouvrement',
    ]);
    const hasInvoiceRecommendation = this.matchesAny(normalized, [
      'what should i invoice',
      'what to invoice',
      'invoice today',
      'bill today',
      'ready to invoice',
      'ready-to-invoice',
      'unbilled',
      'approved timesheets',
      'approved billable',
      'que dois je facturer',
      'quoi facturer',
      'pret a facturer',
      'prets a facturer',
      'pretes a facturer',
      'facturer aujourd hui',
      'facturer aujourdhui',
      'شنو نفوتر',
    ]);

    if (this.matchesAny(normalized, ['approval center', 'approvals', 'approbations', 'validation', 'validations', 'actions en attente', 'pending approvals', 'pending actions'])) {
      candidates.push({ name: 'approval_center', confidence: 0.95 });
    }
    if (this.matchesAny(normalized, ['executive briefing', 'executive summary', 'briefing', 'resume executif', 'résumé exécutif', 'today briefing', 'business briefing', 'vue executive', 'vue exécutive'])) {
      candidates.push({ name: 'executive_briefing', confidence: 0.95 });
    }
    if (hasContract && hasRisk) candidates.push({ name: 'contract_risk', confidence: 0.92 });
    if (hasCustomer && hasRisk) candidates.push({ name: 'customer_risk', confidence: 0.92 });
    if (hasInvoice && hasOverdue) candidates.push({ name: 'overdue_invoices', confidence: 0.94 });
    if (hasInvoiceRecommendation) candidates.push({ name: 'invoice_recommendations', confidence: 0.96 });

    return candidates.sort((left, right) => right.confidence - left.confidence);
  }

  private isSpecificEntitySearchQuery(query: string) {
    const normalized = this.normalizeIntentText(query).trim();
    if (!normalized) return false;
    if (/\b(?:CTR|INV|DEV|CN|CRN|PAY|CUS|CLT)-?\d{4}/i.test(query)) return true;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query.trim())) return true;
    if (/\d/.test(query) && normalized.length <= 40) return true;
    const blockedTerms = [
      'show',
      'find',
      'search',
      'montre',
      'affiche',
      'chercher',
      'contracts',
      'contrats',
      'customers',
      'clients',
      'risk',
      'risky',
      'risque',
      'attention',
      'overdue',
      'retard',
      'critical',
      'priority',
      'prioritaire',
      'expiring',
      'invoice',
      'facture',
    ];
    if (this.matchesAny(normalized, blockedTerms)) return false;
    return normalized.split(/\s+/).filter(Boolean).length <= 5 && normalized.length <= 80;
  }

  private extractHours(value: string) {
    const match = value.match(/(\d+(?:[.,]\d+)?)\s*(?:h|heure|heures|hour|hours)/);
    if (!match?.[1]) return null;
    const hours = Number(match[1].replace(',', '.'));
    return Number.isFinite(hours) && hours > 0 ? hours : null;
  }

  private buildEntitySearchQueries(query: string) {
    const raw = query.trim();
    const normalized = this.normalizeIntentText(raw);
    const stopWords = new Set([
      'create', 'invoice', 'for', 'client', 'customer', 'contract', 'bill', 'prepare',
      'cree', 'creer', 'facture', 'pour', 'contrat', 'le', 'la', 'les', 'des', 'du',
      'show', 'open',
    ]);
    const legalTerms = new Set(['llc', 'ltd', 'inc', 'sarl', 'sa', 'sas']);
    const tokens = normalized
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !stopWords.has(token));

    const queries = new Set<string>();
    if (raw) queries.add(raw);
    if (tokens.length > 0) {
      queries.add(tokens.join(' '));
      for (const token of tokens) {
        if (!legalTerms.has(token)) queries.add(token);
      }
    }

    return [...queries].slice(0, 6);
  }

  private computeEntitySimilarity(left: string | undefined, right: string | undefined) {
    const a = this.normalizeIntentText(left ?? '').replace(/[^a-z0-9]+/g, ' ').trim();
    const b = this.normalizeIntentText(right ?? '').replace(/[^a-z0-9]+/g, ' ').trim();
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.92;
    const distance = this.levenshteinDistance(a, b);
    const maxLength = Math.max(a.length, b.length);
    return maxLength === 0 ? 0 : 1 - distance / maxLength;
  }

  private levenshteinDistance(left: string, right: string) {
    const rows = left.length + 1;
    const cols = right.length + 1;
    const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

    for (let row = 0; row < rows; row += 1) matrix[row]![0] = row;
    for (let col = 0; col < cols; col += 1) matrix[0]![col] = col;

    for (let row = 1; row < rows; row += 1) {
      for (let col = 1; col < cols; col += 1) {
        const cost = left[row - 1] === right[col - 1] ? 0 : 1;
        matrix[row]![col] = Math.min(
          matrix[row - 1]![col]! + 1,
          matrix[row]![col - 1]! + 1,
          matrix[row - 1]![col - 1]! + cost
        );
      }
    }

    return matrix[rows - 1]![cols - 1]!;
  }

  private extractActivity(content: string) {
    const normalized = this.normalizeIntentText(content);
    if (normalized.includes('support')) return 'Support';
    if (normalized.includes('develop') || normalized.includes('dev')) return 'Development';
    if (normalized.includes('maintenance')) return 'Maintenance';
    if (normalized.includes('formation') || normalized.includes('training')) return 'Training';
    return null;
  }

  private async resolveSingleContract(user: AssistantUser, query: string): Promise<{ id: string; contractNumber?: string } | null> {
    const directReference = query.match(/\bCTR-?\d{4}-?\d{0,6}\b/i)?.[0]?.trim();
    if (directReference) {
      const directContract = await prisma.contract.findFirst({
        where: {
          AND: [
            contractAccessWhere(user.id, permissionScope(user.permissionScopes, 'contracts.view')),
            { contractNumber: directReference },
          ],
        },
        select: { id: true, contractNumber: true },
      });
      if (directContract) {
        await this.logAudit(user.id, 'AI_ENTITY_RESOLVED', 'Contract', directContract.id, {
          query,
          displayName: directContract.contractNumber,
          resolution: 'direct_contract_reference',
        });
        return directContract;
      }
    }

    const tool = this.tools.get('search_contracts');
    if (!tool) return null;
    await this.assertCanUseTool(user, tool);
    const result = await tool.execute({ query, limit: 5 }, { user });
    const rows = this.unwrapListToolRows(result);
    const candidates = rows
      .map((row) => this.asRecord(row))
      .filter((row): row is Record<string, unknown> => Boolean(row && typeof row.id === 'string'))
      .map((row) => ({
        id: row.id as string,
        contractNumber: typeof row.contractNumber === 'string' ? row.contractNumber : undefined,
      }));
    if (candidates.length === 0) return null;
    if (candidates.length === 1) {
      await this.logAudit(user.id, 'AI_ENTITY_RESOLVED', 'Contract', candidates[0]!.id, {
        query,
        displayName: candidates[0]!.contractNumber,
      });
      return candidates[0]!;
    }

    const normalizedQuery = this.normalizeIntentText(query).trim();
    const exactMatches = candidates.filter((candidate) =>
      this.normalizeIntentText(candidate.contractNumber ?? '').trim() === normalizedQuery
    );
    if (exactMatches.length > 0) {
      await this.logAudit(user.id, 'AI_ENTITY_RESOLVED', 'Contract', exactMatches[0]!.id, {
        query,
        displayName: exactMatches[0]!.contractNumber,
        resolution: exactMatches.length === 1 ? 'exact_contract_match' : 'exact_contract_match_multiple',
      });
      return exactMatches[0]!;
    }

    const ranked = candidates
      .map((candidate) => ({
        candidate,
        score: this.computeEntitySimilarity(query, candidate.contractNumber),
      }))
      .sort((left, right) => right.score - left.score);
    const best = ranked[0];
    const second = ranked[1];
    if (best && best.score >= 0.72 && (!second || best.score - second.score >= 0.08)) {
      await this.logAudit(user.id, 'AI_ENTITY_RESOLVED', 'Contract', best.candidate.id, {
        query,
        displayName: best.candidate.contractNumber,
        resolution: 'fuzzy_contract_match',
        score: Number(best.score.toFixed(3)),
      });
      return best.candidate;
    }

    return null;
  }

  private async resolveSingleClient(user: AssistantUser, query: string): Promise<{ id: string; name?: string; email?: string } | null> {
    const tool = this.tools.get('search_customers') ?? this.tools.get('search_clients');
    if (!tool) return null;
    await this.assertCanUseTool(user, tool);

    const candidateMap = new Map<string, { id: string; name?: string; email?: string }>();
    for (const searchQuery of this.buildEntitySearchQueries(query)) {
      const result = await tool.execute({ query: searchQuery, limit: 10 }, { user });
      for (const row of this.unwrapListToolRows(result)) {
        const client = this.asRecord(row);
        if (!client || typeof client.id !== 'string') continue;
        candidateMap.set(client.id, {
          id: client.id,
          name: this.stringValue(client.name),
          email: this.stringValue(client.email),
        });
      }
      if (candidateMap.size >= 10) break;
    }

    const candidates = [...candidateMap.values()];
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0]!;

    const normalizedQuery = this.normalizeIntentText(query).trim();
    const exactMatches = candidates.filter((candidate) => {
      const candidateName = this.normalizeIntentText(candidate.name ?? '').trim();
      const candidateEmail = this.normalizeIntentText(candidate.email ?? '').trim();
      return (candidateName && candidateName === normalizedQuery) || (candidateEmail && candidateEmail === normalizedQuery);
    });
    if (exactMatches.length > 0) {
      await this.logAudit(user.id, 'AI_ENTITY_RESOLVED', 'Customer', exactMatches[0]!.id, {
        query,
        displayName: exactMatches[0]!.name ?? exactMatches[0]!.email,
        resolution: exactMatches.length === 1 ? 'exact_client_match' : 'exact_client_match_multiple',
      });
      return exactMatches[0]!;
    }

    const ranked = candidates
      .map((candidate) => ({
        candidate,
        score: Math.max(
          this.computeEntitySimilarity(query, candidate.name),
          this.computeEntitySimilarity(query, candidate.email),
        ),
      }))
      .sort((left, right) => right.score - left.score);

    const best = ranked[0];
    const second = ranked[1];
    if (!best) return null;
    if (best.score >= 0.72 && (!second || best.score - second.score >= 0.08)) {
      await this.logAudit(user.id, 'AI_ENTITY_RESOLVED', 'Customer', best.candidate.id, {
        query,
        displayName: best.candidate.name ?? best.candidate.email,
        resolution: 'fuzzy_client_match',
        score: Number(best.score.toFixed(3)),
      });
      return best.candidate;
    }

    return null;
  }

  private async resolveInvoiceableContractFromSearch(
    user: AssistantUser,
    language: string,
    query: string
  ): Promise<{ id: string; contractNumber?: string; clientName?: string } | null> {
    const tool = this.tools.get('search_contracts');
    if (!tool) return null;
    await this.assertCanUseTool(user, tool);

    const candidates = new Map<string, { id: string; contractNumber?: string; clientName?: string; title?: string; status?: string; score: number }>();
    for (const searchQuery of this.buildEntitySearchQueries(query)) {
      const result = await tool.execute({ query: searchQuery, limit: 10 }, { user });
      for (const row of this.unwrapListToolRows(result)) {
        const contract = this.asRecord(row);
        if (!contract || typeof contract.id !== 'string') continue;
        const clientName = this.stringValue(this.asRecord(contract.client)?.name);
        const contractNumber = this.stringValue(contract.contractNumber);
        const title = this.stringValue(contract.title);
        const score = Math.max(
          this.computeEntitySimilarity(query, clientName),
          this.computeEntitySimilarity(query, title),
          this.computeEntitySimilarity(query, contractNumber),
        );
        const current = candidates.get(contract.id);
        if (!current || score > current.score) {
          candidates.set(contract.id, {
            id: contract.id,
            contractNumber,
            clientName,
            title,
            status: this.stringValue(contract.status),
            score,
          });
        }
      }
    }

    const ranked = [...candidates.values()]
      .filter((candidate) => candidate.score >= 0.58)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return this.contractStatusPriority(right.status) - this.contractStatusPriority(left.status);
      });

    for (const candidate of ranked) {
      const blocked = await this.validateContractInvoiceIntent(
        user,
        language,
        candidate.id,
        candidate.contractNumber ?? candidate.clientName,
        true
      );
      if (!blocked) {
        await this.logAudit(user.id, 'AI_ENTITY_RESOLVED', 'Contract', candidate.id, {
          query,
          displayName: candidate.contractNumber ?? candidate.clientName,
          resolution: 'fuzzy_contract_match',
          score: Number(candidate.score.toFixed(3)),
        });
        return candidate;
      }
    }

    return null;
  }

  private async resolveInvoiceableContractForClient(
    user: AssistantUser,
    language: string,
    clientId: string
  ): Promise<{ id: string; contractNumber?: string } | null> {
    const contracts = await contractService.list(
      user.id,
      permissionScope(user.permissionScopes, 'contracts.view'),
      {
        page: '1',
        limit: '20',
        clientId,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      } as never
    );

    const invoiceable: Array<{ id: string; contractNumber?: string }> = [];
    for (const row of contracts.data as Array<Record<string, unknown>>) {
      if (typeof row.id !== 'string') continue;
      const blocked = await this.validateContractInvoiceIntent(
        user,
        language,
        row.id,
        this.stringValue(row.contractNumber),
        true
      );
      if (!blocked) {
        invoiceable.push({
          id: row.id,
          contractNumber: this.stringValue(row.contractNumber),
        });
        if (invoiceable.length > 1) break;
      }
    }

    return invoiceable.length === 1 ? invoiceable[0]! : null;
  }

  private contractStatusPriority(status?: string) {
    switch (status) {
      case 'ACTIVE':
        return 4;
      case 'VIEWED':
        return 3;
      case 'SENT':
        return 2;
      case 'DRAFT':
        return 1;
      default:
        return 0;
    }
  }

  private async resolveSingleInvoice(user: AssistantUser, query: string): Promise<{ id: string; invoiceNumber?: string } | null> {
    const tool = this.tools.get('search_invoices');
    if (!tool) return null;
    await this.assertCanUseTool(user, tool);
    const result = await tool.execute({ search: query, page: '1', limit: '5' }, { user });
    const rows = this.asArray(this.asRecord(result)?.data ?? result);
    if (rows.length !== 1) return null;
    const invoice = this.asRecord(rows[0]);
    if (!invoice || typeof invoice.id !== 'string') return null;
    await this.logAudit(user.id, 'AI_ENTITY_RESOLVED', 'Invoice', invoice.id, {
      query,
      displayName: invoice.invoiceNumber,
    });
    return { id: invoice.id, invoiceNumber: typeof invoice.invoiceNumber === 'string' ? invoice.invoiceNumber : undefined };
  }

  private async getInvoiceUpdatePayload(user: AssistantUser, invoiceId: string) {
    const invoice = await invoiceService.getInvoiceById(invoiceId, user.id, permissionScope(user.permissionScopes, 'invoices.view'));
    return {
      id: invoice.id,
      customerId: invoice.customerId,
      issueDate: this.toDateOnly(invoice.issueDate),
      dueDate: this.toDateOnly(invoice.dueDate),
      taxRate: Number(invoice.taxRate ?? 0),
      vatOverrideReason: (invoice as Record<string, unknown>).vatOverrideReason ?? null,
      discount: Number(invoice.discount ?? 0),
      notes: invoice.notes ?? null,
      terms: invoice.terms ?? null,
      currency: invoice.currency,
      items: Array.isArray(invoice.items)
        ? invoice.items.map((item) => ({
          description: item.description,
          unit: item.unit ?? null,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          taxRate: Number(item.taxRate ?? invoice.taxRate ?? 0),
        }))
        : [],
    };
  }

  private async validateContractInvoiceIntent(
    user: AssistantUser,
    language: string,
    contractId: string,
    contractLabel?: string | null,
    isWrite = true,
    invoiceInput?: Record<string, unknown>
  ): Promise<AssistantPlan | null> {
    const previewTool = this.tools.get('prepare_invoice_preview');
    const workflowTool = this.tools.get('contract_invoice_workflow');
    const validationTool = isWrite && workflowTool?.preview ? workflowTool : previewTool;
    if (!validationTool) return null;

    try {
      const parsed = validationTool.schema.parse(invoiceInput ?? { contractId });
      const preview = validationTool.preview
        ? await validationTool.preview(parsed, { user })
        : await validationTool.execute(parsed, { user });
      const previewRecord = this.asRecord(preview);
      const summaryRecord = this.asRecord(previewRecord?.summary);
      const invoicePreviewRecord = this.asRecord(summaryRecord?.invoicePreview);
      const contractRecord = this.asRecord(summaryRecord?.contract) ?? this.asRecord(previewRecord?.contract);
      const pricingType = this.stringValue(contractRecord?.pricingType);
      const approvedCount = Number(invoicePreviewRecord?.approvedBillableTimesheetCount ?? previewRecord?.approvedBillableTimesheetCount ?? 0);

      if ((pricingType === 'HOURLY' || pricingType === 'DAILY') && approvedCount <= 0) {
        return {
          response: this.localized(language, {
            fr: `Je ne peux pas ${isWrite ? 'creer une facture' : 'preparer la facturation'} pour ${contractLabel ?? 'ce contrat'} car aucune entree approuvee non facturee n existe sur cette periode.`,
            en: `I cannot ${isWrite ? 'create an invoice' : 'prepare billing'} for ${contractLabel ?? 'this contract'} because there are no approved uninvoiced entries for this billing period.`,
            ar: `لا يمكنني ${isWrite ? 'إنشاء فاتورة' : 'تحضير الفوترة'} للعقد ${contractLabel ?? 'هذا العقد'} لأنه لا توجد إدخالات معتمدة وغير مفوترة لهذه الفترة.`,
          }),
          intent: 'contract_no_ready_entries',
        };
      }
      return null;
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : 'Unable to prepare invoice preview';
      const reference = contractLabel ?? 'this contract';

      if (rawMessage === 'Only active or sent contracts can be invoiced') {
        return {
          response: this.localized(language, {
            fr: `Je ne peux pas ${isWrite ? 'creer une facture' : 'preparer la facturation'} pour ${reference}. Seuls les contrats envoyes, consultes ou actifs peuvent etre factures.`,
            en: `I cannot ${isWrite ? 'create an invoice' : 'prepare billing'} for ${reference}. Only sent, viewed, or active contracts can be invoiced.`,
            ar: `لا يمكنني ${isWrite ? 'إنشاء فاتورة' : 'تحضير الفوترة'} للعقد ${reference}. يمكن فوترة العقود المرسلة أو المعروضة أو النشطة فقط.`,
          }),
          intent: 'contract_not_invoiceable',
        };
      }

      if (rawMessage === 'Contract signature workflow is incomplete') {
        return {
          response: this.localized(language, {
            fr: `Je ne peux pas ${isWrite ? 'creer une facture' : 'preparer la facturation'} pour ${reference} tant que le workflow de signature du contrat n est pas termine.`,
            en: `I cannot ${isWrite ? 'create an invoice' : 'prepare billing'} for ${reference} until the contract signature workflow is completed.`,
            ar: `لا يمكنني ${isWrite ? 'إنشاء فاتورة' : 'تحضير الفوترة'} للعقد ${reference} ما دام مسار توقيع العقد غير مكتمل.`,
          }),
          intent: 'contract_signature_incomplete',
        };
      }

      if (rawMessage === 'No approved uninvoiced entries for this billing period') {
        return {
          response: this.localized(language, {
            fr: `Je ne peux pas ${isWrite ? 'creer une facture' : 'preparer la facturation'} pour ${reference} car aucune entree approuvee non facturee n existe sur cette periode.`,
            en: `I cannot ${isWrite ? 'create an invoice' : 'prepare billing'} for ${reference} because there are no approved uninvoiced entries for this billing period.`,
            ar: `لا يمكنني ${isWrite ? 'إنشاء فاتورة' : 'تحضير الفوترة'} للعقد ${reference} لأنه لا توجد إدخالات معتمدة وغير مفوترة لهذه الفترة.`,
          }),
          intent: 'contract_no_ready_entries',
        };
      }

      return {
        response: this.localized(language, {
          fr: `Je ne peux pas ${isWrite ? 'creer une facture' : 'preparer la facturation'} pour ${reference} : ${rawMessage}.`,
          en: `I cannot ${isWrite ? 'create an invoice' : 'prepare billing'} for ${reference}: ${rawMessage}.`,
          ar: `لا يمكنني ${isWrite ? 'إنشاء فاتورة' : 'تحضير الفوترة'} للعقد ${reference}: ${rawMessage}.`,
        }),
        intent: 'contract_invoice_prerequisite_missing',
      };
    }
  }

  private async prevalidatePlannedToolCall(
    user: AssistantUser,
    language: string,
    plan: AssistantPlan
  ): Promise<AssistantPlan | null> {
    if (!plan.toolCall) return null;
    switch (plan.toolCall.name) {
      case 'contract_invoice_workflow':
      case 'prepare_invoice_preview': {
        const contractId = typeof plan.toolCall.input?.contractId === 'string'
          ? plan.toolCall.input.contractId
          : null;
        if (!contractId) return null;
        return this.validateContractInvoiceIntent(
          user,
          language,
          contractId,
          null,
          plan.toolCall.name === 'contract_invoice_workflow',
          plan.toolCall.input
        );
      }
      case 'convert_quote_to_invoice':
        return this.validateQuoteConversionIntent(user, language, typeof plan.toolCall.input?.id === 'string' ? plan.toolCall.input.id : null);
      case 'update_draft_timesheet':
      case 'submit_timesheet':
      case 'approve_timesheet':
      case 'reject_timesheet':
        return this.validateTimesheetActionIntent(
          user,
          language,
          plan.toolCall.name,
          typeof plan.toolCall.input?.contractId === 'string' ? plan.toolCall.input.contractId : null,
          typeof plan.toolCall.input?.timeEntryId === 'string' ? plan.toolCall.input.timeEntryId : null
        );
      case 'update_credit_note':
      case 'delete_credit_note':
      case 'validate_credit_note':
      case 'cancel_credit_note':
      case 'refund_credit_note':
        return this.validateCreditNoteActionIntent(
          user,
          language,
          plan.toolCall.name,
          typeof plan.toolCall.input?.id === 'string' ? plan.toolCall.input.id : null
        );
      default:
        return null;
    }
  }

  private canUseTool(user: AssistantUser, tool: AiTool): {
    allowed: boolean;
    assistantPermission: string;
    missingPermission?: string;
    reason: 'ALLOWED' | 'MISSING_ASSISTANT_PERMISSION' | 'MISSING_CONFIRM_PERMISSION' | 'MISSING_PERMISSION_SCOPE';
  } {
    const assistantPermission = tool.riskLevel === AiToolRiskLevel.READ_ONLY
      ? AI_ASSISTANT_PERMISSIONS.useReadTools
      : AI_ASSISTANT_PERMISSIONS.useWriteTools;
    if (!user.permissions.includes(AI_ASSISTANT_PERMISSIONS.access) || !user.permissions.includes(assistantPermission)) {
      return { allowed: false, assistantPermission, reason: 'MISSING_ASSISTANT_PERMISSION' };
    }
    if (tool.riskLevel !== AiToolRiskLevel.READ_ONLY && !user.permissions.includes(AI_ASSISTANT_PERMISSIONS.confirmActions)) {
      return { allowed: false, assistantPermission, missingPermission: AI_ASSISTANT_PERMISSIONS.confirmActions, reason: 'MISSING_CONFIRM_PERMISSION' };
    }

    if (tool.anyPermissions?.length) {
      const anyAllowed = tool.anyPermissions.some((permission) => authorizePermission({
        userId: user.id,
        permissions: user.permissions,
        scopes: user.permissionScopes,
        permission,
      }).allowed);
      if (!anyAllowed) {
        return {
          allowed: false,
          assistantPermission,
          missingPermission: tool.anyPermissions[0],
          reason: 'MISSING_PERMISSION_SCOPE',
        };
      }
    }

    const permissionsToCheck = tool.anyPermissions?.length
      ? [...(tool.additionalPermissions ?? [])]
      : [tool.requiredPermission, ...(tool.additionalPermissions ?? [])];
    for (const permission of permissionsToCheck) {
      const authorization = authorizePermission({
        userId: user.id,
        permissions: user.permissions,
        scopes: user.permissionScopes,
        permission,
      });
      if (!authorization.allowed) {
        return { allowed: false, assistantPermission, missingPermission: permission, reason: 'MISSING_PERMISSION_SCOPE' };
      }
    }

    return { allowed: true, assistantPermission, reason: 'ALLOWED' };
  }

  private async filterUnavailableToolPlan(
    user: AssistantUser,
    language: string,
    plan: AssistantPlan
  ): Promise<AssistantPlan | null> {
    if (!plan.toolCall) return null;
    const tool = this.tools.get(plan.toolCall.name);
    if (!tool) return null;
    const authorization = this.canUseTool(user, tool);
    if (authorization.allowed) return null;

    const permission = authorization.missingPermission ?? tool.requiredPermission;
    const message = authorization.reason === 'MISSING_CONFIRM_PERMISSION'
      ? this.localized(language, {
          fr: 'Je peux analyser cette action, mais vous n avez pas la permission de la confirmer et de l exécuter.',
          en: 'I can analyze this action, but you do not have permission to confirm and execute it.',
          ar: 'يمكنني تحليل هذا الإجراء، لكن ليست لديك صلاحية تأكيده وتنفيذه.',
        })
      : this.localized(language, {
          fr: `Je ne peux pas executer cette action car vous n avez pas l autorisation requise (${permission}).`,
          en: `I cannot execute this action because you do not have the required authorization (${permission}).`,
          ar: `لا يمكنني تنفيذ هذا الإجراء لأنك لا تملك الصلاحية المطلوبة (${permission}).`,
        });

    return {
      response: message,
      intent: 'authorization.blocked',
    };
  }

  private async validateQuoteConversionIntent(
    user: AssistantUser,
    language: string,
    quoteId: string | null
  ): Promise<AssistantPlan | null> {
    if (!quoteId) return null;
    const authorization = authorizePermission({
      userId: user.id,
      permissions: user.permissions,
      scopes: user.permissionScopes,
      permission: 'devis.convert',
    });
    if (!authorization.allowed || !authorization.scope) return null;
    const quote = await prisma.devis.findFirst({
      where: { id: quoteId, ...devisAccessWhere(user.id, authorization.scope) },
      select: { devisNumber: true, status: true, convertedAt: true },
    });
    if (!quote) return null;
    if (quote.convertedAt || quote.status === 'CONVERTED') {
      return {
        response: this.localized(language, {
          fr: `Je ne peux pas convertir le devis ${quote.devisNumber} car il a deja ete converti en facture.`,
          en: `I cannot convert quote ${quote.devisNumber} because it has already been converted to an invoice.`,
          ar: `لا يمكنني تحويل عرض السعر ${quote.devisNumber} لأنه تم تحويله بالفعل إلى فاتورة.`,
        }),
        intent: 'quote_already_converted',
      };
    }
    if (quote.status !== 'APPROVED') {
      return {
        response: this.localized(language, {
          fr: `Je ne peux pas convertir le devis ${quote.devisNumber} tant qu il n est pas approuve.`,
          en: `I cannot convert quote ${quote.devisNumber} until it is approved.`,
          ar: `لا يمكنني تحويل عرض السعر ${quote.devisNumber} قبل اعتماده.`,
        }),
        intent: 'quote_not_approved',
      };
    }
    return null;
  }

  private async validateTimesheetActionIntent(
    user: AssistantUser,
    language: string,
    toolName: string,
    contractId: string | null,
    timeEntryId: string | null
  ): Promise<AssistantPlan | null> {
    if (!contractId || !timeEntryId) return null;
    const permissionByTool: Record<string, string> = {
      update_draft_timesheet: 'contracts.time_entries.update',
      submit_timesheet: 'contracts.time_entries.submit',
      approve_timesheet: 'contracts.time_entries.approve',
      reject_timesheet: 'contracts.time_entries.reject',
    };
    const permission = permissionByTool[toolName];
    if (!permission) return null;
    const authorization = authorizePermission({
      userId: user.id,
      permissions: user.permissions,
      scopes: user.permissionScopes,
      permission,
    });
    if (!authorization.allowed || !authorization.scope) return null;
    const entry = await prisma.contractTimeEntry.findFirst({
      where: {
        id: timeEntryId,
        contractId,
        contract: contractAccessWhere(user.id, authorization.scope),
      },
      select: {
        id: true,
        status: true,
        invoiceId: true,
        contract: { select: { contractNumber: true } },
      },
    });
    if (!entry) return null;

    const reference = entry.contract.contractNumber ?? timeEntryId;
    if ((toolName === 'update_draft_timesheet' || toolName === 'submit_timesheet')
      && entry.status !== 'DRAFT'
      && entry.status !== 'REJECTED') {
      return {
        response: this.localized(language, {
          fr: `Je ne peux pas modifier ou soumettre cette feuille de temps du contrat ${reference} car elle n est ni en brouillon ni rejetee.`,
          en: `I cannot update or submit this timesheet for contract ${reference} because it is neither draft nor rejected.`,
          ar: `لا يمكنني تعديل أو إرسال هذه الورقة الزمنية للعقد ${reference} لأنها ليست مسودة ولا مرفوضة.`,
        }),
        intent: 'timesheet_invalid_state',
      };
    }
    if ((toolName === 'approve_timesheet' || toolName === 'reject_timesheet') && entry.status !== 'SUBMITTED') {
      return {
        response: this.localized(language, {
          fr: `Je ne peux pas traiter cette feuille de temps du contrat ${reference} car elle n est pas soumise.`,
          en: `I cannot process this timesheet for contract ${reference} because it is not submitted.`,
          ar: `لا يمكنني معالجة هذه الورقة الزمنية للعقد ${reference} لأنها غير مُرسلة.`,
        }),
        intent: 'timesheet_not_submitted',
      };
    }
    if (toolName === 'approve_timesheet' && (entry.invoiceId || entry.status === 'INVOICED')) {
      return {
        response: this.localized(language, {
          fr: `Je ne peux pas approuver cette feuille de temps du contrat ${reference} car elle est deja facturee.`,
          en: `I cannot approve this timesheet for contract ${reference} because it is already invoiced.`,
          ar: `لا يمكنني اعتماد هذه الورقة الزمنية للعقد ${reference} لأنها مُفوترة بالفعل.`,
        }),
        intent: 'timesheet_already_invoiced',
      };
    }
    return null;
  }

  private async validateCreditNoteActionIntent(
    user: AssistantUser,
    language: string,
    toolName: string,
    creditNoteId: string | null
  ): Promise<AssistantPlan | null> {
    if (!creditNoteId) return null;
    const permissionByTool: Record<string, string> = {
      update_credit_note: 'credit_notes.update',
      delete_credit_note: 'credit_notes.update',
      validate_credit_note: 'credit_notes.validate',
      cancel_credit_note: 'credit_notes.cancel',
      refund_credit_note: 'credit_notes.refund',
    };
    const permission = permissionByTool[toolName];
    if (!permission) return null;
    const authorization = authorizePermission({
      userId: user.id,
      permissions: user.permissions,
      scopes: user.permissionScopes,
      permission,
    });
    if (!authorization.allowed || !authorization.scope) return null;
    const note = await prisma.creditNote.findFirst({
      where: { id: creditNoteId, ...creditNoteAccessWhere(user.id, authorization.scope) },
      select: { creditNoteNumber: true, status: true, refundedAmount: true },
    });
    if (!note) return null;

    const reference = note.creditNoteNumber ?? creditNoteId;
    if ((toolName === 'update_credit_note' || toolName === 'delete_credit_note' || toolName === 'validate_credit_note') && note.status !== 'DRAFT') {
      return {
        response: this.localized(language, {
          fr: `Je ne peux pas traiter l avoir ${reference} car seuls les avoirs en brouillon autorisent cette action.`,
          en: `I cannot process credit note ${reference} because only draft credit notes allow this action.`,
          ar: `لا يمكنني معالجة الإشعار الدائن ${reference} لأن هذه العملية متاحة فقط للمسودات.`,
        }),
        intent: 'credit_note_not_draft',
      };
    }
    if (toolName === 'cancel_credit_note' && note.status !== 'DRAFT' && note.status !== 'VALIDATED') {
      return {
        response: this.localized(language, {
          fr: `Je ne peux pas annuler l avoir ${reference} dans son statut actuel.`,
          en: `I cannot cancel credit note ${reference} in its current status.`,
          ar: `لا يمكنني إلغاء الإشعار الدائن ${reference} في حالته الحالية.`,
        }),
        intent: 'credit_note_cannot_cancel',
      };
    }
    if (toolName === 'refund_credit_note' && note.status !== 'VALIDATED') {
      return {
        response: this.localized(language, {
          fr: `Je ne peux pas rembourser l avoir ${reference} tant qu il n est pas valide.`,
          en: `I cannot refund credit note ${reference} until it is validated.`,
          ar: `لا يمكنني رد مبلغ الإشعار الدائن ${reference} قبل اعتماده.`,
        }),
        intent: 'credit_note_not_validated',
      };
    }
    return null;
  }

  private toDateOnly(value: unknown) {
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) return String(value ?? '');
    return date.toISOString().slice(0, 10);
  }

  private extractPercentValue(content: string) {
    const match = content.match(/(\d+(?:[.,]\d+)?)\s*%/);
    if (!match?.[1]) return null;
    const value = Number(match[1].replace(',', '.'));
    return Number.isFinite(value) ? value : null;
  }

  private extractMoneyValue(content: string) {
    const match = content.match(/(\d+(?:[.,]\d+)?)\s*(?:mad|eur|usd)?/i);
    if (!match?.[1]) return null;
    const value = Number(match[1].replace(',', '.'));
    return Number.isFinite(value) ? value : null;
  }

  private extractLineDescription(content: string) {
    const explicit = content.match(/(?:ligne|line)\s+(?:de|d['’]|of)?\s*([^,.]+?)(?:\s+\d+(?:[.,]\d+)?\s*(?:h|heure|heures|hour|hours)|\s+(?:a|à|at)\s+\d|$)/i)?.[1];
    const fallback = this.extractActivity(content);
    return explicit?.trim() || fallback || 'Service';
  }

  private extractDueDate(content: string, currentDueDate: string) {
    const normalized = this.normalizeIntentText(content);
    const isoMatch = content.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
    if (isoMatch) return isoMatch;
    const slashMatch = content.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
    if (slashMatch) {
      const [, day, month, year] = slashMatch;
      return `${year}-${month}-${day}`;
    }
    const base = new Date(currentDueDate);
    if (Number.isNaN(base.getTime())) return null;
    if (this.matchesAny(normalized, ['next month', 'mois prochain', 'month after', 'chher jaya'])) {
      const next = new Date(base);
      next.setMonth(next.getMonth() + 1);
      return this.toDateOnly(next);
    }
    if (this.matchesAny(normalized, ['today', 'aujourd hui', 'aujourdhui'])) {
      return '2026-08-08';
    }
    return null;
  }

  private async resolveContextReference(user: AssistantUser, conversationId: string, pageContext?: AiMessageInput['context']): Promise<AssistantContextReference> {
    if (pageContext?.entityType === 'contract' && pageContext.entityId) {
      return { contractId: pageContext.entityId, contractReference: pageContext.readableReference, source: 'page' };
    }
    if (pageContext?.entityType === 'invoice' && pageContext.entityId) {
      return { invoiceId: pageContext.entityId, invoiceReference: pageContext.readableReference, source: 'page' };
    }
    if (pageContext?.entityType === 'client') {
      return { clientId: pageContext.entityId, clientReference: pageContext.readableReference, source: 'page' };
    }
    const conversation = await prisma.aiConversation.findFirst({
      where: { id: conversationId, userId: user.id },
      select: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 12,
          select: { metadata: true },
        },
        pendingActions: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { resultPayload: true, previewPayload: true },
        },
      },
    });
    if (!conversation) return { source: 'conversation' };
    for (const action of conversation.pendingActions) {
      const resultReference = this.extractContextReference(action.resultPayload);
      if (resultReference.contractId || resultReference.invoiceId) return { ...resultReference, source: 'conversation' };
      const reference = this.extractContextReference(action.previewPayload);
      if (reference.contractId || reference.invoiceId) return { ...reference, source: 'conversation' };
    }
    for (const message of conversation.messages) {
      const reference = this.extractContextReference(message.metadata);
      if (reference.contractId || reference.invoiceId) return { ...reference, source: 'conversation' };
    }
    return { source: 'conversation' };
  }

  private async resolveOrdinalReference(user: AssistantUser, conversationId: string, ordinal: number): Promise<Omit<AssistantContextReference, 'source'> | null> {
    const conversation = await prisma.aiConversation.findFirst({
      where: { id: conversationId, userId: user.id },
      select: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 12,
          select: { metadata: true },
        },
      },
    });
    if (!conversation) return null;
    for (const message of conversation.messages) {
      const value = this.asRecord(message.metadata);
      const execution = this.asRecord(value?.executionResult);
      const rawResult = execution?.result;
      const resultRecord = this.asRecord(rawResult);
      const rows = this.asArray(resultRecord?.data ?? rawResult);
      const selected = this.asRecord(rows[ordinal - 1]);
      if (!selected) continue;
      const reference = this.extractContextReference(selected);
      if (reference.contractId || reference.invoiceId) return reference;
    }
    return null;
  }

  private async resolveLatestInvoiceReference(user: AssistantUser, conversationId: string): Promise<Pick<AssistantContextReference, 'invoiceId' | 'invoiceReference'> | null> {
    const conversation = await prisma.aiConversation.findFirst({
      where: { id: conversationId, userId: user.id },
      select: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 12,
          select: { metadata: true },
        },
        pendingActions: {
          orderBy: { updatedAt: 'desc' },
          take: 8,
          select: { resultPayload: true },
        },
      },
    });
    if (!conversation) return null;
    for (const action of conversation.pendingActions) {
      const fromResult = this.extractInvoiceReference(action.resultPayload);
      if (fromResult?.invoiceId) return fromResult;
    }
    for (const message of conversation.messages) {
      const fromMessage = this.extractInvoiceReference(message.metadata);
      if (fromMessage?.invoiceId) return fromMessage;
    }
    return null;
  }

  private extractInvoiceReference(payload: unknown): Pick<AssistantContextReference, 'invoiceId' | 'invoiceReference'> | null {
    const value = this.asRecord(payload);
    const execution = this.asRecord(value?.executionResult) ?? value;
    const executionResult = execution?.result;
    const result = this.asRecord(executionResult) ?? this.asRecord(execution?.summary) ?? execution;
    const action = this.asRecord(execution?.action);
    const preview = this.asRecord(action?.previewPayload);
    const previewSummary = this.asRecord(preview?.summary);
    const candidates = [
      result,
      this.asRecord(result?.invoice),
      this.asRecord(result?.createdInvoice),
      this.asRecord(result?.generatedInvoice),
      previewSummary,
      this.asRecord(previewSummary?.invoice),
      ...this.asArray(executionResult).map((item) => this.asRecord(item)),
      ...this.asArray(result).map((item) => this.asRecord(item)),
    ].filter(Boolean) as Record<string, unknown>[];

    for (const candidate of candidates) {
      const invoiceReference = this.stringValue(candidate.invoiceNumber);
      const invoiceId = this.stringValue(candidate.invoiceId ?? candidate.id);
      if (invoiceId && (invoiceReference || String(candidate.invoiceNumber ?? '').startsWith('INV-'))) {
        return { invoiceId, invoiceReference };
      }
    }
    return null;
  }

  private extractContextReference(payload: unknown): Omit<AssistantContextReference, 'source'> {
    const value = this.asRecord(payload);
    const execution = this.asRecord(value?.executionResult) ?? value;
    const executionResult = execution?.result;
    const result = this.asRecord(executionResult) ?? this.asRecord(execution?.summary) ?? execution;
    const action = this.asRecord(execution?.action);
    const preview = this.asRecord(action?.previewPayload);
    const previewSummary = this.asRecord(preview?.summary);
    const candidates = [
      result,
      this.asRecord(result?.contract),
      this.asRecord(result?.invoice),
      previewSummary,
      this.asRecord(previewSummary?.contract),
      this.asRecord(previewSummary?.invoice),
      ...this.asArray(executionResult).map((item) => this.asRecord(item)),
      ...this.asArray(result).map((item) => this.asRecord(item)),
    ].filter(Boolean) as Record<string, unknown>[];

    for (const candidate of candidates) {
      const contractReference = this.stringValue(candidate.contractNumber ?? candidate.contractReference ?? candidate.readableReference);
      const possibleContractId = this.stringValue(candidate.contractId ?? candidate.id);
      if (contractReference || (possibleContractId && (String(candidate.contractNumber ?? '').startsWith('CTR-') || 'workDate' in candidate || 'timeEntry' in candidate))) {
        return { contractId: possibleContractId, contractReference };
      }
      const invoiceReference = this.stringValue(candidate.invoiceNumber ?? candidate.invoiceReference);
      const possibleInvoiceId = this.stringValue(candidate.invoiceId ?? candidate.id);
      if (invoiceReference || (possibleInvoiceId && String(candidate.invoiceNumber ?? '').startsWith('INV-'))) {
        return { invoiceId: possibleInvoiceId, invoiceReference };
      }
      const clientReference = this.stringValue(candidate.clientName ?? candidate.customerName ?? candidate.clientReference ?? candidate.name);
      const possibleClientId = this.stringValue(candidate.clientId ?? candidate.customerId);
      if (clientReference || possibleClientId) {
        return { clientId: possibleClientId, clientReference };
      }
    }
    return {};
  }

  private extractOrdinal(value: string) {
    if (this.matchesAny(value, ['second', '2nd', 'deuxieme', 'deuxième', 'tani', 'الثاني'])) return 2;
    if (this.matchesAny(value, ['third', '3rd', 'troisieme', 'troisième', 'talet', 'الثالث'])) return 3;
    if (this.matchesAny(value, ['first', '1st', 'premier', 'premiere', 'première', 'lowel', 'الأول'])) return 1;
    const match = value.match(/\b([1-9])\b/);
    return match?.[1] ? Number(match[1]) : null;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  }

  private asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  private unwrapListToolRows(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    const record = this.asRecord(value);
    return record ? this.asArray(record.data) : [];
  }

  private stringValue(value: unknown) {
    return typeof value === 'string' && value.trim() ? value : undefined;
  }

  private normalizeIntentText(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  private matchesAny(value: string, terms: string[]) {
    return terms.some((term) => value.includes(this.normalizeIntentText(term)));
  }

  private extractSearchQuery(content: string) {
    const quoted = content.match(/["'“”](.+?)["'“”]/)?.[1];
    if (quoted) return quoted.trim();
    const cleaned = content
      .replace(/montre-moi|affiche|recherche|chercher|show|find|search|werini|dyal|les|des|de|du|contrats?|contracts?|clients?|customers?/gi, ' ')
      .replace(/\b(moi|me|my|please|stp|svp)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned.length >= 2 ? cleaned : null;
  }


  private isExplicitContractInvoiceRequest(
    normalized: string,
    content: string,
    context?: AiMessageInput['context']
  ) {
    if (context?.entityType === 'contract' && context.entityId) {
      return this.matchesAny(normalized, ['this contract', 'ce contrat', 'had contrat', 'invoice this contract', 'bill this contract', 'facture ce contrat']);
    }
    if (/\bCTR-?\d{4}-?\d{0,6}\b/i.test(content)) return true;
    return this.matchesAny(normalized, [
      'contract ',
      'contrat ',
      'invoice this contract',
      'bill this contract',
      'facture ce contrat',
      'facture le contrat',
      'invoice contract',
      'create an invoice for contract',
      'create invoice for contract',
      'creer une facture pour contrat',
      'cree une facture pour contrat',
    ]);
  }

  private buildManualInvoiceClarificationPlan(language: string, customerName: string): AssistantPlan {
    return {
      response: this.localized(language, {
        fr: `J ai retrouve le client ${customerName}. Pour creer la facture via le flux manuel, il me manque encore la date d emission, la date d echeance, la devise et au moins une ligne avec description, quantite et prix unitaire.`,
        en: `I found customer ${customerName}. To create the invoice through the manual flow, I still need the issue date, due date, currency, and at least one line item with description, quantity, and unit price.`,
        ar: `???? ??? ?????? ${customerName}. ?????? ???????? ??? ?????? ??????? ?? ??? ????? ??? ????? ??????? ?????? ????????? ??????? ???? ????? ??? ???? ????? ????? ??????? ???? ??????.`,
      }),
      intent: 'clarify_create_invoice',
    };
  }

  private extractBusinessEntityQuery(content: string) {
    const quoted = content.match(/["'â€œâ€](.+?)["'â€œâ€]/)?.[1];
    if (quoted?.trim()) return quoted.trim();
    const reference = content.match(/\b(?:CTR|INV|DEV|CN|CRN|PAY|CUS|CLT)-?\d{4}-?\d{0,6}\b/i)?.[0];
    if (reference) return reference.trim();
    const invoiceTargetMatch = content.match(/\b(?:dir|cree|creer|create|generate|prepare)\s+(?:une?\s+)?(?:facture|invoice)\s+(?:pour|for|l[' ]?|le\s+|la\s+|client\s+|customer\s+)?(.+?)\s*[.?!]?$/i)?.[1];
    const targetMatch = content.match(/\b(?:pour|for|client|customer|contrat|contract)\s+(?:le\s+|la\s+|les\s+|the\s+|client\s+|customer\s+|contrat\s+|contract\s+)?(.+?)\s*[.?!]?$/i)?.[1];
    const raw = invoiceTargetMatch ?? targetMatch ?? this.extractSearchQuery(content);
    if (!raw) return null;
    const cleaned = raw
      .replace(/^(?:une?\s+|la\s+|le\s+|les\s+|des\s+|du\s+|de\s+|the\s+|a\s+|an\s+|client\s+|customer\s+|contrat\s+|contract\s+|facture\s+|invoice\s+)+/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned.length >= 2 ? cleaned : null;
  }

  private extractCustomerDraft(content: string): {
    name: string | null;
    email: string | null;
    country: string | null;
    countryCode: string | null;
  } {
    const email = this.extractEmailAddress(content);
    const { country, countryCode } = this.extractCountryFromText(content);
    return {
      name: this.extractCustomerName(content, email),
      email,
      country,
      countryCode,
    };
  }

  private extractEmailAddress(content: string) {
    const match = content.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
    return match?.[0]?.trim() ?? null;
  }

  private extractCustomerName(content: string, email?: string | null) {
    const patterns = [
      /\b(?:client|customer)\s+(?:called|named)\s+(.+?)(?=\s+(?:with|avec|using|email|e-?mail|mail|in|au|en)\b|[.!?]?$)/i,
      /\b(?:create|add)\s+(?:a\s+|an\s+|new\s+)?(?:client|customer)\s+(.+?)(?=\s+(?:with|avec|using|email|e-?mail|mail|in|au|en)\b|[.!?]?$)/i,
      /\b(?:cree|creer|ajoute|ajouter)\s+(?:un\s+|une\s+|nouveau\s+|nouvelle\s+)?client\s+(.+?)(?=\s+(?:avec|email|e-?mail|mail|au|en)\b|[.!?]?$)/i,
      /\bclient\s+smito\s+(.+?)(?=\s+(?:b|avec|email|e-?mail|mail|au|en)\b|[.!?]?$)/i,
      /\bzid\s+client(?:\s+jdid)?\s+(.+?)(?=\s+(?:b|avec|email|e-?mail|mail|au|en)\b|[.!?]?$)/i,
      /\bsawb\s+lia\s+client(?:\s+smito)?\s+(.+?)(?=\s+(?:b|avec|email|e-?mail|mail|au|en)\b|[.!?]?$)/i,
    ];
    for (const pattern of patterns) {
      const match = content.match(pattern)?.[1];
      const cleaned = this.cleanCustomerName(match, email);
      if (cleaned) return cleaned;
    }

    const withoutEmail = email ? content.replace(email, ' ') : content;
    const generic = withoutEmail
      .replace(/\b(create|add|new|client|customer|called|named|with|email|mail|in|cree|creer|ajoute|ajouter|nouveau|nouvelle|avec|sawb|lia|smito|zid|jdid)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return this.cleanCustomerName(generic, email);
  }

  private cleanCustomerName(value?: string | null, email?: string | null) {
    if (!value) return null;
    let cleaned = value;
    if (email) {
      cleaned = cleaned.replace(email, ' ');
    }
    cleaned = cleaned
      .replace(/["“”'`]/g, ' ')
      .replace(/\b(?:with|avec|email|e-?mail|mail|in|au|en)\b.*$/i, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned.length >= 2 ? cleaned : null;
  }

  private extractCountryFromText(content: string) {
    const normalized = this.normalizeIntentText(content);
    const countryMap = [
      { aliases: ['morocco', 'maroc', 'al maghrib', 'maghrib', 'المغرب'], code: 'MA' },
      { aliases: ['france'], code: 'FR' },
      { aliases: ['united states', 'usa', 'us', 'etats unis', 'etatsunis'], code: 'US' },
      { aliases: ['united kingdom', 'uk', 'royaume uni', 'royaumeuni'], code: 'GB' },
      { aliases: ['canada'], code: 'CA' },
      { aliases: ['uae', 'united arab emirates', 'emirats arabes unis', 'emirats'], code: 'AE' },
    ];
    for (const entry of countryMap) {
      if (entry.aliases.some((alias) => this.matchesNormalizedAlias(normalized, alias))) {
        const normalizedCode = normalizeCountryCode(entry.code);
        if (!normalizedCode) continue;
        return {
          countryCode: normalizedCode,
          country: getCountryName(normalizedCode, entry.aliases[0] ?? normalizedCode),
        };
      }
    }
    return { country: null, countryCode: null };
  }

  private matchesNormalizedAlias(normalizedContent: string, alias: string) {
    const normalizedAlias = this.normalizeIntentText(alias).trim();
    if (!normalizedAlias) return false;
    if (/[\u0600-\u06ff]/.test(normalizedAlias)) {
      return normalizedContent.includes(normalizedAlias);
    }
    const escaped = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, 'i').test(normalizedContent);
  }

  private localized(language: string, values: { fr: string; en: string; ar: string }) {
    if (language.startsWith('ar')) return values.ar;
    if (language.startsWith('en')) return values.en;
    return values.fr;
  }

  /**
   * PRIMARY, AUTHORITATIVE intent router. Understands the request semantically (any
   * language/phrasing — French, English, Arabic, Moroccan Darija, paraphrases) and
   * classifies it as a business domain + action + read/write + clarification-needed,
   * then — only when unambiguous — selects one tool from the EXISTING tool registry.
   *
   * Safety guarantees that do not depend on the model's judgement:
   * - Tool selection is validated against `this.tools`; a name the model invents or
   *   that isn't registered is dropped, never executed (see requirement: unknown
   *   intents must not invent tool names).
   * - This method never calls a business service directly — it only returns a
   *   `{toolName, input}` pair. The caller (`sendMessage`) still routes every tool
   *   call through the normal `executeTool`/`confirmAction` pipeline, so WRITE tools
   *   (`AiToolRiskLevel.CONFIRMATION_REQUIRED`) still stop at a pending action and
   *   require explicit user confirmation regardless of what this classifier decides.
   * - Returns `null` (classification unavailable) when no API key is configured, the
   *   provider call fails, or the response is empty/malformed — the caller then falls
   *   back to the non-authoritative keyword router (`keywordFallbackPlan`).
   */
  private async classifySemanticIntent(user: AssistantUser, conversationId: string, input: AiMessageInput): Promise<AssistantPlan | null> {
    if (!env.OPENAI_API_KEY) return null;
    const tools = this.listTools(user);
    const contextReference = await this.resolveContextReference(user, conversationId, input.context);
    const normalizedInput = this.normalizeIntentText(input.content);
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        input: [
          {
            role: 'system',
            content: [
              'You are a secure ERP admin assistant. Understand the business request semantically — in any language or phrasing, including French, English, Arabic and Moroccan Darija, and paraphrases — before choosing an action. Return strict JSON only.',
              'Schema: {"intent":{"domain":"invoices|quotes|contracts|clients|payments|expenses|credit_notes|timesheets|reports|pdf|email|workflow|other","action":"create|read|update|delete|send|generate|approve|reject|convert|other","isWrite":boolean,"needsClarification":boolean},"response":"short user-facing answer","toolCall":{"name":"tool_name","input":{}}}.',
              'Classify "intent" first (domain, action, whether it is a write, whether clarification is required), then, only if unambiguous and an existing tool applies, include "toolCall".',
              'Omit "toolCall" entirely when needsClarification is true or no existing tool covers the request. Set needsClarification to true instead of guessing whenever a WRITE action is ambiguous (unclear which record, missing required detail, multiple equally valid interpretations, or a destructive action without a clearly identified target) — never guess a destructive or write action.',
              'Use ONLY the tool names listed in "Available tools" below, exactly as spelled. Never invent a tool name, never invent IDs, never expose secrets, never claim that writes were executed — write tools only prepare pending actions that a human must confirm afterwards.',
              'Before asking the user for IDs, use the current page context and conversation context below to resolve the target record (for example an invoice or contract mentioned earlier in this conversation). Ask for clarification only when context does not resolve the target or multiple valid choices exist.',
              `Current context: ${JSON.stringify(contextReference)}`,
              `Available tools: ${JSON.stringify(tools)}`,
            ].join('\n'),
          },
          { role: 'user', content: input.content },
        ],
        text: { format: { type: 'json_object' } },
      }),
    });
    if (!response.ok) return null;
    const body = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
    const text = body.output_text ?? body.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? '').join('') ?? '';
    if (!text.trim()) return null;

    const validated = semanticClassificationSchema.safeParse(JSON.parse(text));
    if (!validated.success) return null;
    const classification = validated.data;
    const { intent, response: message } = classification;

    if (intent.needsClarification || !classification.toolCall) {
      return { response: message, intent: `${intent.domain}.clarification`, semanticIntent: intent };
    }

    // Never invent tool names: only a name that already exists in the live registry
    // is allowed through. This also protects against a stale/hallucinated tool name
    // from the model.
    const tool = this.tools.get(classification.toolCall.name);
    if (!tool) {
      return null;
    }

    if (['search_contracts', 'search_clients'].includes(classification.toolCall.name)) {
      const query = typeof classification.toolCall.input.query === 'string' ? classification.toolCall.input.query : '';
      if (!this.isSpecificEntitySearchQuery(query)) return null;
    }

    const looksLikeTimesheetCreation =
      this.matchesAny(normalizedInput, ['sawb', 'create', 'cree', 'creer', 'add', 'ajoute'])
      && this.matchesAny(normalizedInput, ['timesheet', 'time sheet', 'feuille', 'temps', 'time'])
      && (
        Boolean(contextReference.contractId)
        || /\bctr-\d{4}-\d+\b/i.test(input.content)
        || this.matchesAny(normalizedInput, ['contrat', 'contract'])
      );
    if (looksLikeTimesheetCreation && ['search_contracts', 'list_timesheets'].includes(classification.toolCall.name)) {
      return null;
    }

    // The model can select a valid tool name but still fill it with the wrong shape
    // (wrong field names, missing required fields). Never let a malformed call reach
    // `executeTool` — validate against the SAME schema `executeTool` will use, and
    // degrade to a clarification-style chat response instead of guessing/crashing.
    if (!tool.schema.safeParse(classification.toolCall.input).success) {
      return null;
    }

    return {
      response: message,
      intent: `${intent.domain}.${intent.action}`,
      toolCall: { name: classification.toolCall.name, input: classification.toolCall.input },
      semanticIntent: intent,
    };
  }

  private sanitizeText(value: string) {
    return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private makeTitle(content: string) {
    const sanitized = this.sanitizeText(content);
    return sanitized.length > 80 ? `${sanitized.slice(0, 77)}...` : sanitized;
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
  }

  private async logPermissionDenied(userId: string | null | undefined, permission: string, operation: string) {
    await this.logAudit(userId ?? null, 'AI_PERMISSION_DENIED', 'AiPermission', null, {
      permission,
      operation,
    }, false);
  }

  private async logReadToolBusinessEvent(userId: string, tool: AiTool, result: unknown) {
    const actionByTool: Record<string, string> = {
      list_approval_center: 'AI_APPROVAL_CENTER_VIEWED',
      get_executive_briefing: 'AI_EXECUTIVE_BRIEFING',
      analyze_contract_health: 'AI_INSIGHT_VIEWED',
      analyze_customer_health: 'AI_INSIGHT_VIEWED',
      analyze_revenue_intelligence: 'AI_RECOMMENDATION_GENERATED',
    };
    const action = actionByTool[tool.name];
    if (!action) return;
    await this.logAudit(userId, action, 'AiInsight', null, {
      toolName: tool.name,
      module: tool.module,
      resultSummary: this.summarizeResult(result),
    });
  }

  private async logAudit(
    userId: string | null,
    action: string,
    entity: string,
    entityId: string | null,
    metadata: Record<string, unknown>,
    success = true
  ) {
    await auditService.logBusinessAction({
      module: 'ai_assistant',
      entity,
      entityId,
      action,
      success,
      metadata: this.sanitizeMetadata(metadata),
      userId,
    });
  }

  private sanitizeMetadata(metadata: Record<string, unknown>) {
    return JSON.parse(JSON.stringify(metadata, (_key, value) => {
      if (typeof value === 'string') {
        return this.sanitizeText(value).slice(0, 500);
      }
      return value;
    })) as Record<string, unknown>;
  }

  private summarizeResult(result: unknown) {
    if (Array.isArray(result)) return { type: 'array', count: result.length };
    if (result && typeof result === 'object') {
      const record = result as Record<string, unknown>;
      return {
        type: 'object',
        keys: Object.keys(record).slice(0, 10),
        id: typeof record.id === 'string' ? record.id : undefined,
        number: record.invoiceNumber ?? record.contractNumber ?? undefined,
      };
    }
    return { type: typeof result };
  }

  private compactExecutionResult(executionResult: unknown) {
    const payload = this.asRecord(executionResult);
    if (!payload) return null;

    const type = this.stringValue(payload.type);
    const toolName = this.stringValue(payload.toolName);

    if (type === 'tool_result') {
      const result = payload.result;
      const reference = this.extractContextReference({ result });
      const invoiceReference = this.extractInvoiceReference({ result });
      return {
        type,
        toolName,
        summary: this.summarizeResult(result),
        result: this.compactConversationResult(result, { ...reference, ...invoiceReference }),
      };
    }

    if (type === 'pending_action') {
      const action = this.asRecord(payload.action);
      return {
        type,
        toolName,
        action: action
          ? {
            id: this.stringValue(action.id),
            toolName: this.stringValue(action.toolName),
            status: this.stringValue(action.status),
          }
          : undefined,
      };
    }

    if (type === 'structured_form') {
      const form = this.asRecord(payload.form);
      return {
        type,
        toolName,
        form: form
          ? {
            toolName: this.stringValue(form.toolName) ?? toolName,
            title: this.stringValue(form.title) ?? '',
            description: this.stringValue(form.description) ?? '',
            submitLabel: this.stringValue(form.submitLabel) ?? '',
            values: this.asRecord(form.values) ?? {},
            missingFields: this.asArray(form.missingFields).filter((value): value is string => typeof value === 'string'),
            fields: this.asArray(form.fields),
            language: this.stringValue(form.language) ?? 'fr',
          }
          : undefined,
      };
    }

    return {
      type,
      toolName,
      summary: this.summarizeResult(payload.result),
    };
  }

  private compactConversationResult(
    result: unknown,
    reference: Record<string, unknown>
  ): Record<string, unknown> | Array<Record<string, unknown>> {
    const paginated = this.asRecord(result);
    const paginatedData = Array.isArray(paginated?.data) ? paginated.data : null;
    if (paginatedData) {
      return paginatedData
        .slice(0, 5)
        .map((item) => this.compactConversationEntity(item))
        .filter((item): item is Record<string, unknown> => Object.keys(item).length > 0);
    }

    if (Array.isArray(result)) {
      return result
        .slice(0, 5)
        .map((item) => this.compactConversationEntity(item))
        .filter((item): item is Record<string, unknown> => Object.keys(item).length > 0);
    }

    return {
      ...reference,
      ...this.compactConversationEntity(result),
      count: Array.isArray(result) ? result.length : undefined,
    };
  }

  private compactConversationEntity(value: unknown): Record<string, unknown> {
    const record = this.asRecord(value);
    if (!record) return {};

    const nestedContract = this.asRecord(record.contract);
    const nestedInvoice = this.asRecord(record.invoice);

    return {
      id: this.stringValue(record.id),
      contractId: this.stringValue(record.contractId ?? nestedContract?.id),
      contractNumber: this.stringValue(record.contractNumber ?? nestedContract?.contractNumber),
      invoiceId: this.stringValue(record.invoiceId ?? nestedInvoice?.id),
      invoiceNumber: this.stringValue(record.invoiceNumber ?? nestedInvoice?.invoiceNumber),
      clientId: this.stringValue(record.clientId ?? record.customerId),
      clientName: this.stringValue(record.clientName ?? record.customerName ?? record.customer ?? record.client ?? record.name),
      name: this.stringValue(record.name ?? record.title),
      status: this.stringValue(record.status),
      workDate: this.stringValue(record.workDate),
    };
  }
  async continueStructuredForm(
  user: AssistantUser,
  input: {
    toolName: string;
    conversationId: string;
    currentValues: Record<string, unknown>;
    missingFields: string[];
    fields: unknown[];
    message: string;
    language: "fr" | "en" | "ar";
  }
) {
  if (!env.OPENAI_API_KEY) {
    throw ApiError.badRequest(
      "AI form completion is unavailable because OPENAI_API_KEY is missing."
    );
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      input: [
        {
          role: "system",
          content: [
            "You complete an existing ERP structured form.",
            "The user's message is a continuation of the current form, NOT a new business request.",
            "Extract only values explicitly provided or clearly implied by the user's message.",
            "Never invent IDs, prices, quantities, dates, VAT rates, clients, products, or other business data.",
            "Return strict JSON only.",
            "Return an object containing only form fields that can be filled from the user's message.",
            "For date fields, return ISO YYYY-MM-DD when the date can be understood.",
            "For array fields, return arrays using the item field structure supplied below.",
            `Missing fields: ${JSON.stringify(input.missingFields)}`,
            `Form fields: ${JSON.stringify(input.fields)}`,
            `Current values: ${JSON.stringify(input.currentValues)}`,
          ].join("\n"),
        },
        {
          role: "user",
          content: input.message,
        },
      ],
      text: {
        format: {
          type: "json_object",
        },
      },
    }),
  });

  if (!response.ok) {
    throw ApiError.badRequest(
      `AI form completion failed with status ${response.status}.`
    );
  }

  const body = (await response.json()) as {
    output_text?: string;
    output?: Array<{
      content?: Array<{
        text?: string;
      }>;
    }>;
  };

  const outputText =
    body.output_text ??
    body.output
      ?.flatMap((item) => item.content ?? [])
      .map((item) => item.text ?? "")
      .join("") ??
    "";

  if (!outputText.trim()) {
    throw ApiError.badRequest(
      "AI form completion returned an empty response."
    );
  }

  let extracted: Record<string, unknown>;

  try {
    extracted = JSON.parse(outputText) as Record<string, unknown>;
  } catch {
    throw ApiError.badRequest(
      "AI form completion returned invalid JSON."
    );
  }

  const mergedInput = this.deepMerge(
    input.currentValues,
    extracted
  );

  return this.executeTool(user, {
    toolName: input.toolName,
    input: mergedInput,
    conversationId: input.conversationId,
    language: input.language,
  });
}
}

export const aiAssistantService = new AiAssistantService();
