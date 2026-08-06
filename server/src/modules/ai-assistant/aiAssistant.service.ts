import { AiActionStatus, AiMessageRole, AiToolRiskLevel, Prisma } from '@prisma/client';
import { env } from '@config/env';
import { prisma } from '@config/database';
import { auditService } from '@modules/audit/audit.service';
import { authorizePermission } from '@modules/rbac/accessScope';
import { ApiError } from '@utils/ApiError';
import { AI_ASSISTANT_PERMISSIONS } from './aiAssistant.permissions';
import { aiTools, toolInputHash } from './tools/contractTools';
import { businessIntelligenceTools } from './tools/businessIntelligenceTools';
import { erpTools } from './tools/erpTools';
import { createEnterpriseWorkflowTools } from './workflows/workflowEngine';
import type { AiMessageInput, AiToolExecutionInput } from './aiAssistant.schema';
import type { AssistantUser, AiTool, ToolContext } from './tools/toolTypes';

type AssistantPlan = {
  response: string;
  intent?: string;
  toolCall?: {
    name: string;
    input: Record<string, unknown>;
  };
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
  | 'create_invoice'
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
  private tools = new Map<string, AiTool>(aiTools.map((tool) => [tool.name, tool]));

  constructor() {
    for (const tool of businessIntelligenceTools) {
      this.tools.set(tool.name, tool);
    }
    for (const tool of erpTools) {
      this.tools.set(tool.name, tool);
    }
    for (const tool of createEnterpriseWorkflowTools(this.tools)) {
      this.tools.set(tool.name, tool);
    }
  }

  listTools(user: AssistantUser) {
    return [...this.tools.values()]
      .filter((tool) => user.permissions.includes(tool.requiredPermission))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        module: tool.module,
        riskLevel: tool.riskLevel,
        requiredPermission: tool.requiredPermission,
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

    const plan = await this.planResponse(user, conversation.id, input);
    await this.logAudit(user.id, 'AI_INTENT_DETECTED', 'AiConversation', conversation.id, {
      intent: plan.intent ?? 'unknown',
      hasToolCall: Boolean(plan.toolCall),
    });
    let executionResult: unknown = null;

    if (plan.toolCall) {
      executionResult = await this.executeTool(user, {
        conversationId: conversation.id,
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
        metadata: this.toJson({ executionResult }),
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

    const parsed = tool.schema.parse(input.input);
    const context: ToolContext = { user };

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
  }) {
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
    const assistantPermission = tool.riskLevel === AiToolRiskLevel.READ_ONLY
      ? AI_ASSISTANT_PERMISSIONS.useReadTools
      : AI_ASSISTANT_PERMISSIONS.useWriteTools;
    if (!user.permissions.includes(AI_ASSISTANT_PERMISSIONS.access) || !user.permissions.includes(assistantPermission)) {
      await this.logPermissionDenied(user.id, assistantPermission, tool.name);
      throw ApiError.forbidden('You are not allowed to use this assistant action.');
    }
    const authorization = authorizePermission({
      userId: user.id,
      permissions: user.permissions,
      scopes: user.permissionScopes,
      permission: tool.requiredPermission,
    });
    if (!authorization.allowed) {
      await this.logPermissionDenied(user.id, tool.requiredPermission, tool.name);
      throw ApiError.forbidden(this.friendlyPermissionDenied(tool.requiredPermission));
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

    const fallback = await this.ruleBasedPlan(user, conversationId, input.content, input.language, input.context);
    if (fallback) return fallback;

    const openAiPlan = await this.callOpenAi(user, conversationId, input).catch(() => null);
    if (openAiPlan) return openAiPlan;

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

  private async ruleBasedPlan(user: AssistantUser, conversationId: string, content: string, language: string, pageContext?: AiMessageInput['context']): Promise<AssistantPlan | null> {
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

    if (routedIntent[0]?.name === 'create_invoice') {
      if (contextContractId) {
        return {
          response: this.localized(language, {
            fr: `J ai trouve ${contextContractLabel}. Je prepare une creation de facture a confirmer avec les donnees facturables disponibles.`,
            en: `I found ${contextContractLabel}. I am preparing invoice creation for confirmation using available billable data.`,
            ar: `وجدت ${contextContractLabel}. سأحضر إنشاء فاتورة للتأكيد باستخدام البيانات القابلة للفوترة المتاحة.`,
          }),
          intent: 'contract_invoice_workflow',
          toolCall: { name: 'contract_invoice_workflow', input: { contractId: contextContractId } },
        };
      }
      const invoiceTarget = this.extractBusinessEntityQuery(content);
      if (invoiceTarget) {
        const contract = await this.resolveSingleContract(user, invoiceTarget);
        if (contract) {
          return {
            response: this.localized(language, {
              fr: `J ai trouve le contrat ${contract.contractNumber ?? ''} lie a ${invoiceTarget}. Je prepare la facture a confirmer.`,
              en: `I found contract ${contract.contractNumber ?? ''} linked to ${invoiceTarget}. I am preparing the invoice for confirmation.`,
              ar: `وجدت العقد ${contract.contractNumber ?? ''} المرتبط ب ${invoiceTarget}. سأحضر الفاتورة للتأكيد.`,
            }),
            intent: 'contract_invoice_workflow',
            toolCall: { name: 'contract_invoice_workflow', input: { contractId: contract.id } },
          };
        }
        return {
          response: this.localized(language, {
            fr: `Je dois choisir le contrat a facturer pour ${invoiceTarget}. Je recherche les contrats accessibles correspondant a ce client.`,
            en: `I need to choose which contract to invoice for ${invoiceTarget}. I am searching accessible contracts for that customer.`,
            ar: `أحتاج إلى اختيار العقد الذي سيتم فوترته ل ${invoiceTarget}. سأبحث عن العقود المتاحة لهذا العميل.`,
          }),
          intent: 'search_contracts_for_invoice',
          toolCall: { name: 'search_contracts', input: { query: invoiceTarget, limit: 5 } },
        };
      }
      return {
        response: this.localized(language, {
          fr: 'Pour creer une facture, j ai besoin d un contrat ou d un client identifiable. Donnez une reference de contrat comme CTR-2026 ou un nom client.',
          en: 'To create an invoice, I need an identifiable contract or customer. Give me a contract reference like CTR-2026 or a customer name.',
          ar: 'لإنشاء فاتورة، أحتاج إلى عقد أو عميل يمكن تحديده. أعطني مرجع عقد مثل CTR-2026 أو اسم عميل.',
        }),
        intent: 'clarify_create_invoice',
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
      return {
        response: this.localized(language, {
          fr: 'Je peux creer un devis apres confirmation. Il me faut le client, la date, la validite, les lignes, les prix et la devise.',
          en: 'I can create a quote after confirmation. I need the customer, issue date, validity date, line items, prices and currency.',
          ar: 'يمكنني إنشاء عرض سعر بعد التأكيد. أحتاج إلى العميل وتاريخ الإصدار وتاريخ الصلاحية والبنود والأسعار والعملة.',
        }),
        intent: 'quote_tools_available',
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
        intent: 'get_invoice_details',
        toolCall: { name: 'search_audit_logs', input: { search: invoiceNumber, limit: 10 } },
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

    if (hasCreate && hasInvoice && !hasPdf) setScore('create_invoice', 0.97);
    if (!hasPdf && this.matchesAny(normalized, ['facture pour', 'facture ce client', 'facture ce contrat', 'invoice for', 'invoice this customer', 'invoice this contract', 'bill for'])) {
      setScore('create_invoice', 0.98);
    }
    if (hasCreate && hasQuote) setScore('create_quote', 0.95);
    if (hasPdf) setScore('generate_pdf', 0.94);
    if (hasTimesheet) setScore('timesheet', hasCreate ? 0.93 : 0.82);
    if (hasPayment) setScore('payment', 0.86);
    if (hasContract && !hasRisk && !hasCreate) setScore('contract', 0.72);
    if (hasCustomer && !hasRisk && !hasCreate) setScore('customer', 0.72);
    if (hasReport) setScore('reports', 0.78);
    if (hasContract && hasRisk && !hasCreate) setScore('contract_risk', 0.92);
    if (hasCustomer && hasRisk && !hasCreate) setScore('customer_risk', 0.92);
    if (hasInvoice && hasOverdue && !hasCreate) setScore('overdue_invoices', 0.94);
    if (hasInvoiceRecommendation) setScore('invoice_recommendations', 0.96);
    if (this.matchesAny(normalized, ['approval center', 'approvals', 'approbations', 'pending approvals', 'pending actions', 'actions en attente'])) {
      setScore('approval_center', 0.95);
    }
    if (this.matchesAny(normalized, ['executive briefing', 'executive summary', 'briefing', 'business briefing', 'resume executif', 'vue executive'])) {
      setScore('executive_briefing', 0.95);
    }

    if (!hasPdf && hasCreate && hasCustomer) addScore('create_invoice', 0.04);
    if (!hasPdf && hasCreate && hasContract) addScore('create_invoice', 0.04);

    const priority: AssistantIntentName[] = [
      'create_invoice',
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

  private extractActivity(content: string) {
    const normalized = this.normalizeIntentText(content);
    if (normalized.includes('support')) return 'Support';
    if (normalized.includes('develop') || normalized.includes('dev')) return 'Development';
    if (normalized.includes('maintenance')) return 'Maintenance';
    if (normalized.includes('formation') || normalized.includes('training')) return 'Training';
    return null;
  }

  private async resolveSingleContract(user: AssistantUser, query: string): Promise<{ id: string; contractNumber?: string } | null> {
    const tool = this.tools.get('search_contracts');
    if (!tool) return null;
    await this.assertCanUseTool(user, tool);
    const result = await tool.execute({ query, limit: 5 }, { user });
    if (!Array.isArray(result) || result.length !== 1) return null;
    const contract = result[0] as Record<string, unknown>;
    if (typeof contract.id !== 'string') return null;
    await this.logAudit(user.id, 'AI_ENTITY_RESOLVED', 'Contract', contract.id, {
      query,
      displayName: contract.contractNumber,
    });
    return { id: contract.id, contractNumber: typeof contract.contractNumber === 'string' ? contract.contractNumber : undefined };
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
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 12 },
        pendingActions: { orderBy: { createdAt: 'desc' }, take: 5 },
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
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 12 } },
    });
    if (!conversation) return null;
    for (const message of conversation.messages) {
      const value = this.asRecord(message.metadata);
      const execution = this.asRecord(value?.executionResult);
      const rows = this.asArray(execution?.result);
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
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 12 },
        pendingActions: { orderBy: { updatedAt: 'desc' }, take: 8 },
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
      const contractReference = this.stringValue(candidate.contractNumber ?? candidate.readableReference);
      const possibleContractId = this.stringValue(candidate.contractId ?? candidate.id);
      if (contractReference || (possibleContractId && (String(candidate.contractNumber ?? '').startsWith('CTR-') || 'workDate' in candidate || 'timeEntry' in candidate))) {
        return { contractId: possibleContractId, contractReference };
      }
      const invoiceReference = this.stringValue(candidate.invoiceNumber);
      const possibleInvoiceId = this.stringValue(candidate.invoiceId ?? candidate.id);
      if (invoiceReference || (possibleInvoiceId && String(candidate.invoiceNumber ?? '').startsWith('INV-'))) {
        return { invoiceId: possibleInvoiceId, invoiceReference };
      }
      const clientReference = this.stringValue(candidate.clientName ?? candidate.customerName ?? candidate.name);
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

  private extractBusinessEntityQuery(content: string) {
    const quoted = content.match(/["'â€œâ€](.+?)["'â€œâ€]/)?.[1];
    if (quoted?.trim()) return quoted.trim();
    const reference = content.match(/\b(?:CTR|INV|DEV|CN|CRN|PAY|CUS|CLT)-?\d{4}-?\d{0,6}\b/i)?.[0];
    if (reference) return reference.trim();
    const targetMatch = content.match(/\b(?:pour|for|client|customer|contrat|contract)\s+(?:le\s+|la\s+|les\s+|the\s+|client\s+|customer\s+|contrat\s+|contract\s+)?(.+?)\s*[.?!]?$/i)?.[1];
    const raw = targetMatch ?? this.extractSearchQuery(content);
    if (!raw) return null;
    const cleaned = raw
      .replace(/\b(?:une?|la|le|les|des|du|de|the|a|an|client|customer|contrat|contract|facture|invoice)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned.length >= 2 ? cleaned : null;
  }

  private localized(language: string, values: { fr: string; en: string; ar: string }) {
    if (language.startsWith('ar')) return values.ar;
    if (language.startsWith('en')) return values.en;
    return values.fr;
  }

  private async callOpenAi(user: AssistantUser, conversationId: string, input: AiMessageInput): Promise<AssistantPlan | null> {
    if (!env.OPENAI_API_KEY) return null;
    const tools = this.listTools(user);
    const contextReference = await this.resolveContextReference(user, conversationId, input.context);
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
              'You are a secure ERP admin assistant. Return strict JSON only.',
              'Schema: {"response":"short user-facing answer","toolCall":{"name":"tool_name","input":{}}} or {"response":"clarifying answer"}.',
              'Use only the provided tools. Never invent IDs, never expose secrets, never claim that writes were executed. Write tools only prepare pending actions.',
              'Before asking the user for IDs, use the current page context and conversation context below. Ask only when multiple valid choices exist.',
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
    const parsed = JSON.parse(text) as AssistantPlan;
    if (!parsed.response || typeof parsed.response !== 'string') return null;
    if (parsed.toolCall && !this.tools.has(parsed.toolCall.name)) return { response: parsed.response };
    if (parsed.toolCall && ['search_contracts', 'search_clients'].includes(parsed.toolCall.name)) {
      const query = typeof parsed.toolCall.input?.query === 'string' ? parsed.toolCall.input.query : '';
      if (!this.isSpecificEntitySearchQuery(query)) return null;
    }
    return parsed;
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
}

export const aiAssistantService = new AiAssistantService();
