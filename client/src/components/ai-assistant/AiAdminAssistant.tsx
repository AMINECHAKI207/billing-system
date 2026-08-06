import {
  Archive,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  Coins,
  Copy,
  Download,
  Eraser,
  Eye,
  FileText,
  History,
  Loader2,
  Plus,
  ReceiptText,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserRound,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  archiveAiConversation,
  cancelAiAction,
  confirmAiAction,
  createAiConversation,
  executeAiTool,
  getAiAssistantBriefing,
  getAiConversation,
  getAiConversationHistory,
  sendAiAssistantMessage,
  type AiAssistantBriefing,
  type AiConversation,
  type AiAssistantContext,
  type AiMessage,
  type AiPendingAction,
} from '@/lib/api';
import { useToast } from '@/hooks/useToast';

type Props = {
  context?: AiAssistantContext;
  getApiErrorMessage: (error: unknown, fallback: string) => string;
};

type ExecutionResult = {
  type?: string;
  toolName?: string;
  result?: unknown;
  action?: AiPendingAction;
};

type Translate = ReturnType<typeof useTranslation>['t'];

const exampleKeys = ['approvalCenter', 'executiveBriefing', 'contractHealth', 'revenueIntelligence', 'findContract', 'contractConsumption', 'viewTimesheets', 'prepareInvoice', 'viewInvoice'] as const;

export function AiAdminAssistant({ context, getApiErrorMessage }: Props) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversationId, setConversationId] = useState('');
  const [draft, setDraft] = useState('');
  const [editingAction, setEditingAction] = useState<AiPendingAction | null>(null);

  const language = i18n.language.startsWith('ar') ? 'ar' : i18n.language.startsWith('en') ? 'en' : 'fr';

  const conversationQuery = useQuery({
    queryKey: ['ai-assistant', 'conversation', conversationId],
    queryFn: () => getAiConversation(conversationId),
    enabled: open && Boolean(conversationId),
  });

  const historyQuery = useQuery({
    queryKey: ['ai-assistant', 'history'],
    queryFn: getAiConversationHistory,
    enabled: open && historyOpen,
  });

  const briefingQuery = useQuery({
    queryKey: ['ai-assistant', 'briefing', language],
    queryFn: getAiAssistantBriefing,
    enabled: open && !historyOpen,
    staleTime: 60_000,
  });

  const createConversationMutation = useMutation({
    mutationFn: () => createAiConversation(language),
    onSuccess: (conversation) => {
      setConversationId(conversation.id);
      setHistoryOpen(false);
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('aiAssistant.errors.open'))),
  });

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const id = conversationId || (await createAiConversation(language)).id;
      setConversationId(id);
      return sendAiAssistantMessage(id, content, language, context);
    },
    onSuccess: async () => {
      setDraft('');
      await queryClient.invalidateQueries({ queryKey: ['ai-assistant'] });
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('aiAssistant.errors.send'))),
  });

  const confirmMutation = useMutation({
    mutationFn: confirmAiAction,
    onSuccess: async () => {
      toast.success(t('aiAssistant.actionConfirmed'));
      await queryClient.invalidateQueries({ queryKey: ['ai-assistant'] });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contracts'] }),
        queryClient.invalidateQueries({ queryKey: ['invoices'] }),
      ]);
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('aiAssistant.errors.confirm'))),
  });

  const cancelMutation = useMutation({
    mutationFn: cancelAiAction,
    onSuccess: async () => {
      toast.info(t('aiAssistant.actionCancelled'));
      await queryClient.invalidateQueries({ queryKey: ['ai-assistant'] });
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('aiAssistant.errors.cancel'))),
  });

  const archiveConversationMutation = useMutation({
    mutationFn: archiveAiConversation,
    onSuccess: async (_, archivedId) => {
      if (conversationId === archivedId) {
        setConversationId('');
      }
      toast.info(t('aiAssistant.conversationArchived'));
      await queryClient.invalidateQueries({ queryKey: ['ai-assistant'] });
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('aiAssistant.errors.archive'))),
  });

  const reviseActionMutation = useMutation({
    mutationFn: async ({ action, input }: { action: AiPendingAction; input: Record<string, unknown> }) => {
      const result = await executeAiTool({
        toolName: action.toolName,
        input,
        conversationId,
        idempotencyKey: `ai-revision-${action.id}-${Date.now()}`,
      });
      await cancelAiAction(action.id);
      return result;
    },
    onSuccess: async () => {
      setEditingAction(null);
      toast.success(t('aiAssistant.actionRevised'));
      await queryClient.invalidateQueries({ queryKey: ['ai-assistant'] });
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('aiAssistant.errors.revise'))),
  });

  useEffect(() => {
    if (!open || conversationId || createConversationMutation.isPending) return;
    createConversationMutation.mutate();
  }, [conversationId, createConversationMutation, open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  const conversation = conversationQuery.data;
  const pendingActions = useMemo(
    () => (conversation?.pendingActions ?? []).filter((action) => action.status === 'PENDING'),
    [conversation]
  );
  const latestPendingActionByTool = useMemo(() => {
    const actionsByTool = new Map<string, AiPendingAction>();
    for (const action of pendingActions) {
      const current = actionsByTool.get(action.toolName);
      if (!current || new Date(action.createdAt).getTime() > new Date(current.createdAt).getTime()) {
        actionsByTool.set(action.toolName, action);
      }
    }
    return actionsByTool;
  }, [pendingActions]);
  const messages = useMemo(() => conversation?.messages ?? [], [conversation?.messages]);
  const latestAssistantMessageId = useMemo(
    () => [...messages].reverse().find((message) => message.role === 'ASSISTANT')?.id ?? '',
    [messages]
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.trim() || sendMutation.isPending) return;
    sendMutation.mutate(draft.trim());
  };

  const startNewConversation = () => {
    setDraft('');
    setConversationId('');
    createConversationMutation.mutate();
  };

  const clearConversation = () => {
    setDraft('');
    if (conversationId) {
      archiveConversationMutation.mutate(conversationId);
      return;
    }
    startNewConversation();
  };

  const regenerateLastResponse = () => {
    const lastUserMessage = [...messages].reverse().find((message) => message.role === 'USER');
    if (!lastUserMessage || sendMutation.isPending) return;
    sendMutation.mutate(lastUserMessage.content);
  };

  const copyMessage = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      toast.success(t('aiAssistant.responseCopied'));
    } catch {
      toast.error(t('aiAssistant.errors.copy'));
    }
  };

  const confirmLatestPendingAction = (action: AiPendingAction) => {
    const latestAction = latestPendingActionByTool.get(action.toolName) ?? action;
    confirmMutation.mutate(latestAction.id);
  };

  return (
    <>
      <button
        aria-label={t('aiAssistant.open')}
        className="fixed bottom-5 end-5 z-40 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-lg shadow-primary/25 transition hover:bg-primary/90 focus:outline-none focus:ring-4 focus:ring-primary/20"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Sparkles className="h-5 w-5" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-slate-950/35 p-2 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="ai-assistant-title">
          <div className="flex h-[92vh] max-h-[92vh] w-full max-w-[600px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 transition-all duration-200 dark:border-slate-800 dark:bg-slate-950 sm:w-[min(92vw,560px)] lg:w-[560px] xl:w-[600px]">
            <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 p-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Bot className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <h2 id="ai-assistant-title" className="truncate text-base font-semibold text-slate-950 dark:text-slate-50">{t('aiAssistant.title')}</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{t('aiAssistant.subtitle')}</p>
                    <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                      <ShieldCheck className="h-3 w-3" />
                      {t('aiAssistant.secureBadge')}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button className="rounded-md p-2 text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-900" onClick={startNewConversation} type="button" aria-label={t('aiAssistant.newConversation')}>
                    <Plus className="h-4 w-4" />
                  </button>
                  <button className="rounded-md p-2 text-slate-500 transition hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-900" disabled={!conversationId || archiveConversationMutation.isPending} onClick={clearConversation} type="button" aria-label={t('aiAssistant.clearConversation')}>
                    <Eraser className="h-4 w-4" />
                  </button>
                  <button className="rounded-md p-2 text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-900" onClick={() => setHistoryOpen((value) => !value)} type="button" aria-label={t('aiAssistant.history')}>
                    <History className="h-4 w-4" />
                  </button>
                  <button className="rounded-md p-2 text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-900" onClick={() => setOpen(false)} type="button" aria-label={t('common.close')}>
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5">
              {historyOpen ? (
                <ConversationHistory
                  conversations={historyQuery.data ?? []}
                  disabled={archiveConversationMutation.isPending}
                  loading={historyQuery.isLoading}
                  onArchive={(id) => archiveConversationMutation.mutate(id)}
                  onSelect={(id) => {
                    setConversationId(id);
                    setHistoryOpen(false);
                  }}
                />
              ) : null}

              {!historyOpen && !messages.length ? (
                <EmptyState
                  briefing={briefingQuery.data}
                  context={context}
                  loading={briefingQuery.isLoading}
                  onPickExample={setDraft}
                />
              ) : null}

              {!historyOpen ? (
                <div className="space-y-3">
                  {messages.map((message) => (
                    <MessageBubble
                      canRegenerate={message.id === latestAssistantMessageId && !sendMutation.isPending}
                      key={message.id}
                      message={message}
                      onCopy={() => copyMessage(message.content)}
                      onRegenerate={regenerateLastResponse}
                    />
                  ))}
                  {sendMutation.isPending ? (
                    <ThinkingSteps />
                  ) : null}
                  {(conversationQuery.isLoading || createConversationMutation.isPending) ? (
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('aiAssistant.progress.loading')}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {pendingActions.length && !historyOpen ? (
                <section className="mt-4 space-y-2">
                  <h3 className="text-xs font-semibold uppercase text-slate-500">{t('aiAssistant.pendingActions')}</h3>
                  {pendingActions.map((action) => (
                    <PendingActionCard
                      action={action}
                      disabled={confirmMutation.isPending || cancelMutation.isPending}
                      key={action.id}
                      onCancel={() => cancelMutation.mutate(action.id)}
                      onConfirm={() => confirmLatestPendingAction(action)}
                      onModify={() => setEditingAction(action)}
                    />
                  ))}
                </section>
              ) : null}

              {!historyOpen && messages.length ? (
                <SuggestedActions disabled={sendMutation.isPending} messages={messages} onPickExample={setDraft} onRegenerate={regenerateLastResponse} />
              ) : null}
            </div>

            <form className="shrink-0 border-t border-slate-200 bg-white/95 p-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 sm:p-5" onSubmit={handleSubmit}>
              <div className="flex gap-2">
                <input
                  className="h-10 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={t('aiAssistant.placeholder')}
                  value={draft}
                />
                <button className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-primary text-white transition hover:bg-primary/90 disabled:opacity-60" disabled={sendMutation.isPending || !draft.trim()} type="submit" aria-label={t('aiAssistant.send')}>
                  {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
            </form>
          </div>
          {editingAction ? (
            <PendingActionEditDialog
              action={editingAction}
              disabled={reviseActionMutation.isPending}
              onClose={() => setEditingAction(null)}
              onSave={(input) => reviseActionMutation.mutate({ action: editingAction, input })}
            />
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function EmptyState({ briefing, context, loading, onPickExample }: {
  briefing?: AiAssistantBriefing;
  context?: AiAssistantContext;
  loading: boolean;
  onPickExample: (value: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.startsWith('ar') ? 'ar' : i18n.language.startsWith('en') ? 'en' : 'fr';
  const cards = buildBriefingCards(briefing, t, locale);
  const priorities = (briefing?.priorities ?? []).filter((item) => item && typeof item === 'object').slice(0, 5);
  const insights = (briefing?.insights ?? []).filter((item) => item && typeof item === 'object').slice(0, 4);
  const recentActivity = (briefing?.recentActivity ?? []).filter((item) => item && typeof item === 'object').slice(0, 6);
  const alerts = (briefing?.alerts ?? []).filter((item) => item && typeof item === 'object').slice(0, 4);
  const recommendations = (briefing?.recommendations ?? []).filter(Boolean).slice(0, 5);
  const suggestions = buildDynamicSuggestions(briefing, t);
  const hasBusinessData = cards.length > 0 || priorities.length > 0 || insights.length > 0 || alerts.length > 0 || recommendations.length > 0;
  return (
    <section className="flex min-h-full flex-col justify-center space-y-4 py-4">
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-primary/10 via-white to-slate-50 p-5 shadow-sm transition-all duration-200 motion-safe:hover:-translate-y-0.5 dark:border-slate-800 dark:from-primary/15 dark:via-slate-950 dark:to-slate-900">
        <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:items-start sm:text-start">
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-sm shadow-primary/25">
            <Sparkles className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">{timeGreeting(t)}</h3>
            <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-primary">{t('aiAssistant.dynamicHome.todaysErpSummary')}</p>
            <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
              {hasBusinessData ? executiveBriefingText(briefing, t, locale) : t('aiAssistant.dynamicHome.healthyText')}
            </p>
          </div>
        </div>
      </div>
      {loading ? <BriefingSkeleton /> : null}
      {!loading && briefing?.executiveSummary ? <ExecutiveOverview summary={briefing.executiveSummary} /> : null}
      {!loading && cards.length ? (
        <div className="grid grid-cols-2 gap-2">
          {cards.map((card) => (
            <button
              className="rounded-xl border border-slate-200 bg-white p-3 text-start shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/5 active:scale-[0.99] focus:outline-none focus:ring-4 focus:ring-primary/15 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-900/80"
              key={card.key}
              onClick={() => window.location.assign(card.route)}
              type="button"
            >
              <span className="flex items-start justify-between gap-2">
                <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${card.tone}`}>
                  <card.icon className="h-4 w-4" />
                </span>
                {card.trend ? (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    card.trend.direction === 'up'
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                      : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
                  }`}>
                    {card.trend.direction === 'up' ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    {card.trend.value}
                  </span>
                ) : null}
              </span>
              <span className="mt-3 block truncate text-lg font-semibold text-slate-950 dark:text-slate-50" title={card.value}>{card.value}</span>
              <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400" title={card.label}>{card.label}</span>
              <span className="mt-2 inline-flex text-[11px] font-semibold text-primary">{t('aiAssistant.dynamicHome.openFilteredPage')}</span>
            </button>
          ))}
        </div>
      ) : null}
      {context?.readableReference ? (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm text-slate-700 shadow-sm dark:text-slate-200">
          <p className="text-xs font-semibold uppercase text-primary">{t('aiAssistant.dynamicHome.workingOn')}</p>
          <p className="mt-1 truncate" title={context.readableReference}>{context.readableReference}</p>
        </div>
      ) : null}
      {!loading && priorities.length ? <TodayPriorities priorities={priorities} onPickExample={onPickExample} /> : null}
      {!loading && insights.length ? <BusinessInsights insights={insights} onPickExample={onPickExample} /> : null}
      {!loading && recentActivity.length ? <RecentActivityTimeline activities={recentActivity} /> : null}
      {!loading && alerts.length ? <BusinessAlerts alerts={alerts} /> : null}
      {!loading && recommendations.length ? <RecommendationList recommendations={recommendations} onPickExample={onPickExample} /> : null}
      {!loading && !hasBusinessData ? <HealthyState /> : null}
      <div>
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('aiAssistant.dynamicHome.suggestions')}</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {suggestions.map((suggestion, index) => (
            <button
              className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-start text-sm text-slate-700 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/5 active:scale-[0.99] dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              key={suggestion}
              onClick={() => onPickExample(suggestion)}
              type="button"
            >
              <span className="flex items-start gap-2">
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  {index % 2 === 0 ? <BriefcaseBusiness className="h-3.5 w-3.5" /> : <ReceiptText className="h-3.5 w-3.5" />}
                </span>
                <span>{suggestion}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
          <ShieldCheck className="h-4 w-4 text-primary" />
          {t('aiAssistant.securityTitle')}
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">{t('aiAssistant.securityText')}</p>
      </div>
    </section>
  );
}

type BriefingCard = {
  key: string;
  label: string;
  value: string;
  prompt: string;
  route: string;
  tone: string;
  icon: typeof Sparkles;
  trend?: {
    direction: 'up' | 'down';
    value: string;
  };
};

function BriefingSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, index) => (
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900" key={index}>
          <div className="h-8 w-8 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
          <div className="mt-3 h-5 w-16 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
          <div className="mt-2 h-3 w-24 animate-pulse rounded bg-slate-100 dark:bg-slate-800/80" />
        </div>
      ))}
    </div>
  );
}

function ExecutiveOverview({ summary }: { summary: Record<string, unknown> }) {
  const { t, i18n } = useTranslation();
  const currency = String(summary.currency ?? 'MAD');
  const items = [
    ['revenueThisMonth', summary.revenueThisMonth, 'revenue'],
    ['outstandingBalance', summary.outstandingBalance, 'balance'],
    ['readyToInvoiceRevenue', summary.readyToInvoiceRevenue, 'ready'],
    ['pendingApprovalCount', summary.pendingApprovalCount, 'count'],
  ] as const;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
        <BarChart3 className="h-4 w-4 text-primary" />
        {t('aiAssistant.dynamicHome.executiveOverview')}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2">
        {items.map(([key, value, kind]) => {
          const formatted = kind === 'count'
            ? formatBusinessValue(key, value, t, i18n.language)
            : formatMoney(numberValue(value), currency, i18n.language);
          return (
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-950/60" key={key}>
              <dt className="truncate text-[10px] font-semibold uppercase text-slate-500">{t(`aiAssistant.fields.${key}`)}</dt>
              <dd className="mt-1 truncate text-sm font-semibold text-slate-950 dark:text-slate-50" title={formatted}>{formatted}</dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

function TodayPriorities({ priorities, onPickExample }: { priorities: Array<Record<string, unknown>>; onPickExample: (value: string) => void }) {
  const { t, i18n } = useTranslation();
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
        <Clock3 className="h-4 w-4 text-primary" />
        {t('aiAssistant.dynamicHome.todayPriorities')}
      </div>
      <ol className="mt-3 space-y-2">
        {priorities.map((priority, index) => {
          const severity = String(priority.severity ?? 'MEDIUM');
          const action = actionPromptFromType(String(priority.actionType ?? ''), t);
          const amount = numberValue(priority.amount) > 0 ? formatMoney(numberValue(priority.amount), String(priority.currency ?? 'MAD'), i18n.language) : '';
          return (
            <li className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-950/60" key={`${String(priority.title ?? index)}-${index}`}>
              <div className="flex items-start gap-2">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="break-words font-semibold text-slate-950 dark:text-slate-50">{readable(priority.title, t)}</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${riskBadgeClass(severity)}`}>{translatedStatus(severity, t)}</span>
                  </div>
                  <p className="mt-1 leading-5 text-slate-600 dark:text-slate-300">{readable(priority.explanation, t)}</p>
                  {amount ? <p className="mt-1 font-semibold text-primary">{amount}</p> : null}
                  <button className="mt-2 inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 transition hover:border-primary/40 hover:bg-primary/5 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" onClick={() => onPickExample(action)} type="button">
                    <Sparkles className="h-3 w-3" />
                    {action}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function BusinessInsights({ insights, onPickExample }: { insights: Array<Record<string, unknown>>; onPickExample: (value: string) => void }) {
  const { t, i18n } = useTranslation();
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
        <TrendingUp className="h-4 w-4 text-primary" />
        {t('aiAssistant.dynamicHome.businessInsights')}
      </div>
      <div className="mt-3 space-y-2">
        {insights.map((insight, index) => {
          const severity = String(insight.severity ?? 'MEDIUM');
          const action = actionPromptFromType(String(insight.actionType ?? ''), t);
          const health = insight.healthScore == null ? '' : healthScoreLabel(insight.healthScore, i18n.language);
          const confidence = confidenceLabel(insight.confidence, t, i18n.language);
          return (
            <article className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 dark:border-slate-800 dark:bg-slate-950/60" key={`${String(insight.entityName ?? index)}-${index}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-950 dark:text-slate-50" title={readable(insight.entityName, t)}>{readable(insight.entityName, t)}</p>
                  <p className="mt-0.5 truncate text-slate-500" title={readable(insight.customer ?? insight.module, t)}>{readable(insight.customer ?? insight.module, t)}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${riskBadgeClass(severity)}`}>{translatedStatus(severity, t)}</span>
              </div>
              <p className="mt-2 leading-5 text-slate-700 dark:text-slate-200">{readable(insight.explanation, t)}</p>
              {confidence ? (
                <span className="mt-2 inline-flex rounded-full border border-primary/15 bg-primary/5 px-2 py-1 text-[11px] font-semibold text-primary">
                  {confidence}
                </span>
              ) : null}
              <div className="mt-2 rounded-md border border-primary/10 bg-white p-2 dark:border-primary/20 dark:bg-slate-900">
                <p className="text-[10px] font-semibold uppercase text-primary">{t('aiAssistant.dynamicHome.whyItMatters')}</p>
                <p className="mt-1 leading-5 text-slate-700 dark:text-slate-200">{readable(insight.businessImpact, t)}</p>
              </div>
              <details className="mt-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-800 dark:bg-slate-900">
                <summary className="cursor-pointer text-[11px] font-semibold text-slate-600 transition hover:text-primary dark:text-slate-300">{t('aiAssistant.dynamicHome.whySeeingThis')}</summary>
                <dl className="mt-2 space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
                  <div><dt className="inline font-semibold">{t('aiAssistant.dynamicHome.affectedEntity')}: </dt><dd className="inline">{readable(insight.entityName, t)}</dd></div>
                  <div><dt className="inline font-semibold">{t('aiAssistant.dynamicHome.detectedConditions')}: </dt><dd className="inline">{formatDetectedConditions(insight.detectedConditions, t)}</dd></div>
                  <div><dt className="inline font-semibold">{t('aiAssistant.dynamicHome.expectedImpact')}: </dt><dd className="inline">{readable(insight.businessImpact, t)}</dd></div>
                </dl>
              </details>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {health ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{t('aiAssistant.dynamicHome.healthScore')}: {health}</span> : null}
                <button className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2 text-[11px] font-semibold text-white transition hover:bg-primary/90" onClick={() => onPickExample(action)} type="button">
                  <Zap className="h-3 w-3" />
                  {action}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RecentActivityTimeline({ activities }: { activities: Array<Record<string, unknown>> }) {
  const { t, i18n } = useTranslation();
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
        <History className="h-4 w-4 text-primary" />
        {t('aiAssistant.dynamicHome.recentActivity')}
      </div>
      <ol className="mt-3 space-y-0">
        {activities.map((activity, index) => (
          <li className="relative ms-3 border-s border-slate-200 pb-3 ps-4 text-xs last:border-transparent last:pb-0 dark:border-slate-800" key={String(activity.id ?? index)}>
            <span className={`absolute -start-[5px] top-1 h-2.5 w-2.5 rounded-full ${activity.success === false ? 'bg-rose-500' : 'bg-primary'}`} />
            <p className="font-semibold text-slate-950 dark:text-slate-50">
              {businessActionLabel(String(activity.action ?? ''), t)}
            </p>
            <p className="mt-0.5 truncate text-slate-600 dark:text-slate-300" title={readable(activity.entityName, t)}>
              {readable(activity.entityName, t)}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {readable(activity.actor, t)} · {formatBusinessValue('createdAt', activity.createdAt, t, i18n.language)}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function BusinessAlerts({ alerts }: { alerts: Array<Record<string, unknown>> }) {
  const { t, i18n } = useTranslation();
  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/20">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4" />
        {t('aiAssistant.dynamicHome.liveAlerts')}
        </div>
        <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-slate-950/50 dark:text-amber-200">
          {t('aiAssistant.itemsCount', { count: alerts.length })}
        </span>
      </div>
      <div className="mt-2 space-y-2">
        {alerts.map((alert, index) => {
          const risk = String(alert.riskLevel ?? 'MEDIUM');
          const reference = readable(alert.reference ?? alert.entityName ?? alert.module, t);
          const customer = formatBusinessValue('client', alert.customer ?? alert.client, t, i18n.language);
          const status = formatBusinessValue('status', alert.status, t, i18n.language);
          const daysRemaining = formatBusinessValue('daysRemaining', alert.daysRemaining, t, i18n.language);
          const remainingBudget = formatBusinessValue('remainingBudget', alert.remainingBudget, t, i18n.language);
          const actionPrompt = buildAlertActionPrompt(alert, t);
          return (
            <article className="rounded-lg border border-white/70 bg-white/90 p-3 text-xs shadow-sm transition hover:border-amber-300 dark:border-amber-900/40 dark:bg-slate-950/60" key={`${String(alert.reference ?? index)}-${index}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900 dark:text-slate-100" title={reference}>{reference}</p>
                  <p className="mt-0.5 truncate text-slate-500 dark:text-slate-400" title={customer !== '-' ? customer : String(alert.module ?? '')}>
                    {customer !== '-' ? customer : readable(alert.module, t)}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 font-semibold ${riskBadgeClass(risk)}`}>{translatedStatus(risk, t)}</span>
              </div>
              <p className="mt-2 break-words leading-5 text-slate-700 dark:text-slate-200">{readable(alert.warning ?? alert.message, t)}</p>
              <dl className="mt-2 grid grid-cols-2 gap-2">
                {status !== '-' ? <MiniMetric label={t('aiAssistant.dynamicHome.status')} value={status} /> : null}
                <MiniMetric label={t('aiAssistant.dynamicHome.risk')} value={translatedStatus(risk, t)} />
                {remainingBudget !== '-' ? <MiniMetric label={t('aiAssistant.dynamicHome.remainingBudget')} value={remainingBudget} /> : null}
                {daysRemaining !== '-' ? <MiniMetric label={t('aiAssistant.dynamicHome.daysRemaining')} value={daysRemaining} /> : null}
              </dl>
              <button
                className="mt-3 inline-flex h-8 items-center gap-2 rounded-md bg-amber-600 px-3 text-[11px] font-semibold text-white transition hover:bg-amber-700 focus:outline-none focus:ring-4 focus:ring-amber-300/40"
                onClick={() => window.location.assign(String(alert.module ?? '').toLowerCase().includes('invoice') ? '/invoices' : String(alert.module ?? '').toLowerCase().includes('customer') ? '/clients' : '/contracts')}
                type="button"
              >
                <Eye className="h-3.5 w-3.5" />
                {actionPrompt}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RecommendationList({ recommendations, onPickExample }: { recommendations: unknown[]; onPickExample: (value: string) => void }) {
  const { t, i18n } = useTranslation();
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
        <Zap className="h-4 w-4 text-primary" />
        {t('aiAssistant.dynamicHome.recommendations')}
      </div>
      <div className="mt-2 space-y-2">
        {recommendations.map((recommendation, index) => {
          const card = normalizeRecommendation(recommendation, t, i18n.language);
          return (
            <article
              className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-700 shadow-sm transition hover:border-primary/30 hover:bg-primary/5 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
              key={`${card.title}-${index}`}
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Zap className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-950 dark:text-slate-50">{card.title}</p>
                  <p className="mt-1 leading-5 text-slate-600 dark:text-slate-300">{card.explanation}</p>
                  {card.confidence ? <p className="mt-1 text-[11px] font-semibold text-primary">{card.confidence}</p> : null}
                </div>
              </div>
              <div className="mt-3 rounded-md border border-primary/10 bg-white p-2 dark:border-primary/20 dark:bg-slate-900">
                <p className="text-[11px] font-semibold uppercase text-primary">{t('aiAssistant.dynamicHome.businessImpact')}</p>
                <p className="mt-1 leading-5 text-slate-700 dark:text-slate-200">{card.impact}</p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {card.actions.map((action) => (
                  <button
                    className="inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-[11px] font-semibold text-white transition hover:bg-primary/90 focus:outline-none focus:ring-4 focus:ring-primary/20"
                    key={action}
                    onClick={() => onPickExample(action)}
                    type="button"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {action}
                  </button>
                ))}
              </div>
              <details className="mt-3 rounded-md border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-800 dark:bg-slate-900">
                <summary className="cursor-pointer text-[11px] font-semibold text-slate-600 transition hover:text-primary dark:text-slate-300">{t('aiAssistant.dynamicHome.whySeeingThis')}</summary>
                <p className="mt-2 text-[11px] leading-5 text-slate-600 dark:text-slate-300">{card.why}</p>
              </details>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-white/70 px-2 py-1.5 dark:bg-slate-900/70">
      <dt className="truncate text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="truncate text-[11px] font-semibold text-slate-900 dark:text-slate-100" title={value}>{value}</dd>
    </div>
  );
}

function HealthyState() {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/20">
      <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-200">
        <CheckCircle2 className="h-4 w-4" />
        {t('aiAssistant.dynamicHome.everythingGood')}
      </div>
      <p className="mt-1 text-xs leading-5 text-emerald-700 dark:text-emerald-300">{t('aiAssistant.dynamicHome.noUrgentActions')}</p>
    </div>
  );
}

function buildBriefingCards(briefing: AiAssistantBriefing | undefined, t: Translate, locale: string): BriefingCard[] {
  const revenue = briefing?.revenue && typeof briefing.revenue === 'object' ? briefing.revenue : {};
  const contract = briefing?.highestRiskContract && typeof briefing.highestRiskContract === 'object' ? briefing.highestRiskContract : null;
  const customer = briefing?.highestRiskCustomer && typeof briefing.highestRiskCustomer === 'object' ? briefing.highestRiskCustomer : null;
  const cards: Array<BriefingCard | null> = [
    numberValue(briefing?.pendingApprovals) > 0 ? {
      key: 'pendingApprovals',
      label: t('aiAssistant.dynamicHome.pendingApprovals'),
      value: formatBusinessValue('pendingApprovals', briefing?.pendingApprovals, t, locale),
      prompt: t('aiAssistant.dynamicHome.prompts.reviewApprovals'),
      route: '/audit-logs?action=PENDING',
      tone: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
      icon: Clock3,
    } : null,
    numberValue(revenue.readyToInvoiceCount) > 0 ? {
      key: 'readyToInvoice',
      label: t('aiAssistant.dynamicHome.readyToInvoice'),
      value: formatBusinessValue('readyToInvoiceCount', revenue.readyToInvoiceCount, t, locale),
      prompt: t('aiAssistant.dynamicHome.prompts.generateInvoices'),
      route: '/contracts?billing=ready-to-invoice',
      tone: 'bg-primary/10 text-primary',
      icon: FileText,
    } : null,
    numberValue(revenue.readyToInvoiceRevenue) > 0 ? {
      key: 'readyRevenue',
      label: t('aiAssistant.dynamicHome.readyRevenue'),
      value: formatMoney(numberValue(revenue.readyToInvoiceRevenue), String(revenue.currency ?? 'MAD'), locale),
      prompt: t('aiAssistant.dynamicHome.prompts.viewRevenueReady'),
      route: '/contracts?billing=ready-to-invoice',
      tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
      icon: Coins,
      trend: extractTrend(revenue, 'readyToInvoiceRevenue', locale),
    } : null,
    numberValue(revenue.overdueCount) > 0 ? {
      key: 'overdue',
      label: t('aiAssistant.dynamicHome.overdue'),
      value: formatBusinessValue('overdueCount', revenue.overdueCount, t, locale),
      prompt: t('aiAssistant.dynamicHome.prompts.reviewOverdue'),
      route: '/invoices?status=OVERDUE',
      tone: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
      icon: AlertTriangle,
    } : null,
    contract ? {
      key: 'contractRisk',
      label: t('aiAssistant.dynamicHome.contractRisk'),
      value: healthScoreLabel(contract.healthScore, locale),
      prompt: t('aiAssistant.dynamicHome.prompts.reviewContracts'),
      route: '/contracts?sort=risk',
      tone: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300',
      icon: BarChart3,
    } : null,
    customer ? {
      key: 'customerRisk',
      label: t('aiAssistant.dynamicHome.customerRisk'),
      value: healthScoreLabel(100 - numberValue(customer.riskScore), locale),
      prompt: t('aiAssistant.dynamicHome.prompts.reviewCustomers'),
      route: '/clients?sort=risk',
      tone: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
      icon: TrendingUp,
    } : null,
  ];
  return cards.filter((card): card is BriefingCard => Boolean(card)).slice(0, 6);
}

function buildDynamicSuggestions(briefing: AiAssistantBriefing | undefined, t: Translate): string[] {
  const revenue = briefing?.revenue && typeof briefing.revenue === 'object' ? briefing.revenue : {};
  const suggestions = [
    numberValue(briefing?.pendingApprovals) > 0 ? t('aiAssistant.dynamicHome.prompts.reviewApprovals') : null,
    numberValue(revenue.readyToInvoiceCount) > 0 ? t('aiAssistant.dynamicHome.prompts.generateInvoices') : null,
    numberValue(revenue.overdueCount) > 0 ? t('aiAssistant.dynamicHome.prompts.reviewOverdue') : null,
    briefing?.highestRiskContract ? t('aiAssistant.dynamicHome.prompts.reviewContracts') : null,
    briefing?.highestRiskCustomer ? t('aiAssistant.dynamicHome.prompts.reviewCustomers') : null,
    ...(briefing?.recommendations ?? []).slice(0, 2).map((item) => readable(item, t)),
  ].filter((item): item is string => Boolean(item));
  const fallback = exampleKeys.slice(0, 6).map((key) => t(`aiAssistant.examples.${key}`));
  return Array.from(new Set(suggestions.length ? suggestions : fallback)).slice(0, 6);
}

function timeGreeting(t: Translate): string {
  const hour = new Date().getHours();
  if (hour < 12) return t('aiAssistant.dynamicHome.goodMorning');
  if (hour < 18) return t('aiAssistant.dynamicHome.goodAfternoon');
  return t('aiAssistant.dynamicHome.goodEvening');
}

function numberValue(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function riskBadgeClass(risk: string): string {
  if (risk === 'HIGH') return 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300';
  if (risk === 'LOW') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300';
  return 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300';
}

function ThinkingSteps() {
  const { t } = useTranslation();
  const steps = [
    t('aiAssistant.progress.analyzingErp'),
    t('aiAssistant.progress.searchingRecords'),
    t('aiAssistant.progress.calculating'),
    t('aiAssistant.progress.preparingRecommendations'),
  ];
  return (
    <div className="me-8 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
      <div className="flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        {t('aiAssistant.progress.thinking')}
      </div>
      <ol className="mt-3 space-y-2">
        {steps.map((step, index) => (
          <li className="flex items-center gap-2 text-xs" key={step}>
            <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
              index === 0 ? 'bg-primary/10 text-primary' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300'
            }`}>
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function normalizeRecommendation(value: unknown, t: Translate, locale: string): { title: string; explanation: string; impact: string; actions: string[]; confidence: string; why: string } {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const action = actionPromptFromType(String(record.actionType ?? ''), t);
    return {
      title: readable(record.title ?? record.entityName ?? t('aiAssistant.dynamicHome.recommendationTitles.general'), t),
      explanation: readable(record.explanation, t),
      impact: readable(record.businessImpact ?? record.impact, t),
      actions: [action],
      confidence: confidenceLabel(record.confidence, t, locale),
      why: [
        readable(record.explanation, t),
        formatDetectedConditions(record.detectedConditions, t),
        readable(record.businessImpact ?? record.impact, t),
      ].filter((item) => item && item !== '-').join(' '),
    };
  }
  const text = readable(value, t);
  const [reference, message] = text.includes(':') ? text.split(/:(.*)/s).filter(Boolean).map((part) => part.trim()) : ['', text];
  const lowered = message.toLowerCase();
  const title = reference
    ? t('aiAssistant.dynamicHome.recommendationFor', { reference })
    : lowered.includes('overdue')
      ? t('aiAssistant.dynamicHome.recommendationTitles.overdue')
      : lowered.includes('invoice')
        ? t('aiAssistant.dynamicHome.recommendationTitles.invoice')
        : t('aiAssistant.dynamicHome.recommendationTitles.general');
  const impact = lowered.includes('invoice')
    ? t('aiAssistant.dynamicHome.impacts.cashflow')
    : lowered.includes('overdue')
      ? t('aiAssistant.dynamicHome.impacts.collection')
      : lowered.includes('renewal') || lowered.includes('contract')
        ? t('aiAssistant.dynamicHome.impacts.retention')
        : t('aiAssistant.dynamicHome.impacts.control');
  const action = lowered.includes('overdue')
    ? t('aiAssistant.dynamicHome.prompts.reviewOverdue')
    : lowered.includes('invoice')
      ? t('aiAssistant.dynamicHome.prompts.generateInvoices')
      : lowered.includes('customer')
        ? t('aiAssistant.dynamicHome.prompts.reviewCustomers')
        : t('aiAssistant.dynamicHome.prompts.reviewContracts');
  return {
    title,
    explanation: message || text,
    impact,
    actions: [action],
    confidence: '',
    why: message || text,
  };
}

function confidenceLabel(value: unknown, t: Translate, locale: string): string {
  const score = numberValue(value);
  if (!score) return '';
  const level = score >= 85 ? t('aiAssistant.dynamicHome.highConfidence') : score >= 70 ? t('aiAssistant.dynamicHome.mediumConfidence') : t('aiAssistant.dynamicHome.lowConfidence');
  return `${level} (${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(score)}%)`;
}

function formatDetectedConditions(value: unknown, t: Translate): string {
  if (!Array.isArray(value) || !value.length) return t('aiAssistant.dynamicHome.availableData');
  return value.map((item) => {
    const key = `aiAssistant.dynamicHome.conditions.${String(item)}`;
    const translated = t(key);
    return translated !== key ? translated : humanizeKey(String(item));
  }).join(', ');
}

function businessActionLabel(value: string, t: Translate): string {
  const key = `aiAssistant.dynamicHome.activityActions.${value}`;
  const translated = t(key);
  return translated !== key ? translated : humanizeKey(value);
}

function buildContextualFollowUps(messages: AiMessage[], t: Translate): string[] {
  const latestExecution = [...messages].reverse().map(getExecutionResult).find(Boolean);
  const result = latestExecution?.result;
  const records = Array.isArray(result) ? result : result && typeof result === 'object' ? [result] : [];
  const text = JSON.stringify(records).toLowerCase();
  const suggestions = [
    text.includes('contract') || text.includes('ctr-') ? t('aiAssistant.dynamicHome.prompts.reviewContracts') : null,
    text.includes('timesheet') || text.includes('billable') ? t('aiAssistant.examples.viewTimesheets') : null,
    text.includes('invoice') || text.includes('readytoinvoice') ? t('aiAssistant.dynamicHome.prompts.generateInvoices') : null,
    text.includes('customer') || text.includes('client') ? t('aiAssistant.dynamicHome.prompts.reviewCustomers') : null,
    text.includes('overdue') || text.includes('balancedue') ? t('aiAssistant.dynamicHome.prompts.reviewOverdue') : null,
  ].filter((item): item is string => Boolean(item));
  const fallback = exampleKeys.slice(1, 4).map((key) => t(`aiAssistant.examples.${key}`));
  return Array.from(new Set(suggestions.length ? suggestions : fallback)).slice(0, 4);
}

function executiveBriefingText(briefing: AiAssistantBriefing | undefined, t: Translate, locale: string): string {
  const summary = briefing?.executiveSummary && typeof briefing.executiveSummary === 'object' ? briefing.executiveSummary : {};
  const currency = String(summary.currency ?? 'MAD');
  const ready = numberValue(summary.readyToInvoiceRevenue);
  const overdue = numberValue(summary.overdueAmount);
  const approvals = numberValue(summary.pendingApprovalCount ?? briefing?.pendingApprovals);
  if (ready > 0) {
    return t('aiAssistant.dynamicHome.briefingReadyRevenue', {
      amount: formatMoney(ready, currency, locale),
      approvals,
    });
  }
  if (overdue > 0) {
    return t('aiAssistant.dynamicHome.briefingOverdue', {
      amount: formatMoney(overdue, currency, locale),
      approvals,
    });
  }
  return t('aiAssistant.dynamicHome.summaryText');
}

function actionPromptFromType(actionType: string, t: Translate): string {
  const actions: Record<string, string> = {
    VIEW_CONTRACT: t('aiAssistant.dynamicHome.prompts.reviewContracts'),
    OPEN_CUSTOMER: t('aiAssistant.dynamicHome.prompts.reviewCustomers'),
    GENERATE_INVOICE_DRAFT: t('aiAssistant.dynamicHome.prompts.generateInvoices'),
    REVIEW_TIMESHEETS: t('aiAssistant.examples.viewTimesheets'),
    SEND_REMINDER: t('aiAssistant.dynamicHome.prompts.reviewOverdue'),
    REVIEW_PAYMENTS: t('aiAssistant.dynamicHome.prompts.reviewOverdue'),
    REVIEW_APPROVALS: t('aiAssistant.dynamicHome.prompts.reviewApprovals'),
  };
  return actions[actionType] ?? t('aiAssistant.examples.executiveBriefing');
}

function buildAlertActionPrompt(alert: Record<string, unknown>, t: Translate): string {
  const module = String(alert.module ?? '').toLowerCase();
  if (module.includes('invoice')) return t('aiAssistant.dynamicHome.actions.openInvoices');
  if (module.includes('customer')) return t('aiAssistant.dynamicHome.actions.openCustomer');
  return t('aiAssistant.dynamicHome.actions.openContract');
}

function healthScoreLabel(value: unknown, locale: string): string {
  const score = Math.max(0, Math.min(100, Math.round(numberValue(value))));
  return `${new Intl.NumberFormat(locale).format(score)}/100`;
}

function extractTrend(record: Record<string, unknown>, field: string, locale: string): BriefingCard['trend'] {
  const candidates = [`${field}Trend`, `${field}ChangePercent`, `${field}TrendPercent`, 'trendPercent', 'changePercent'];
  for (const candidate of candidates) {
    const value = numberValue(record[candidate]);
    if (!value) continue;
    return {
      direction: value >= 0 ? 'up' : 'down',
      value: `${value >= 0 ? '+' : ''}${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)}%`,
    };
  }
  return undefined;
}

function SuggestedActions({ disabled, messages, onPickExample, onRegenerate }: {
  disabled: boolean;
  messages: AiMessage[];
  onPickExample: (value: string) => void;
  onRegenerate: () => void;
}) {
  const { t } = useTranslation();
  const followUps = buildContextualFollowUps(messages, t);
  return (
    <section className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
      <p className="text-xs font-semibold uppercase text-slate-500">{t('aiAssistant.nextActions')}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {followUps.map((label) => (
          <button
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-primary/40 hover:bg-primary/5 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
            disabled={disabled}
            key={label}
            onClick={() => onPickExample(label)}
            type="button"
          >
            {label}
          </button>
        ))}
        <button
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-primary/40 hover:bg-primary/5 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          disabled={disabled}
          onClick={onRegenerate}
          type="button"
        >
          <RefreshCw className="h-3 w-3" />
          {t('aiAssistant.regenerateResponse')}
        </button>
      </div>
    </section>
  );
}

function ConversationHistory({ conversations, disabled, loading, onArchive, onSelect }: {
  conversations: AiConversation[];
  disabled: boolean;
  loading: boolean;
  onArchive: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />{t('common.loading')}</div>;
  }
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('aiAssistant.history')}</h3>
      {conversations.length ? conversations.map((conversation) => (
        <div
          className="flex gap-2 rounded-lg border border-slate-200 bg-white p-2 transition hover:border-primary/40 hover:bg-primary/5 dark:border-slate-800 dark:bg-slate-900"
          key={conversation.id}
        >
          <button
            className="min-w-0 flex-1 text-start"
            onClick={() => onSelect(conversation.id)}
            type="button"
          >
            <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">{conversation.title || t('aiAssistant.untitledConversation')}</span>
            <span className="mt-1 block text-xs text-slate-500">{new Date(conversation.updatedAt).toLocaleString()}</span>
          </button>
          <button
            aria-label={t('aiAssistant.archiveConversation')}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 disabled:opacity-60 dark:hover:bg-slate-800"
            disabled={disabled}
            onClick={() => onArchive(conversation.id)}
            type="button"
          >
            <Archive className="h-4 w-4" />
          </button>
        </div>
      )) : <p className="text-sm text-slate-500">{t('aiAssistant.noHistory')}</p>}
    </section>
  );
}

function MessageBubble({ canRegenerate, message, onCopy, onRegenerate }: {
  canRegenerate: boolean;
  message: AiMessage;
  onCopy: () => void;
  onRegenerate: () => void;
}) {
  const { t } = useTranslation();
  const execution = getExecutionResult(message);
  const isAssistant = message.role === 'ASSISTANT';
  return (
    <div className={`rounded-xl border p-3 text-sm ${message.role === 'USER' ? 'ms-8 border-primary/20 bg-primary/5 text-slate-900 dark:text-slate-100' : 'me-8 border-slate-200 bg-white text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200'}`}>
      <MarkdownContent content={message.content} />
      {execution ? <ResultCard execution={execution} /> : null}
      {isAssistant ? (
        <div className="mt-3 flex justify-end gap-1 border-t border-slate-100 pt-2 dark:border-slate-800">
          <button
            aria-label={t('aiAssistant.copyResponse')}
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={onCopy}
            type="button"
          >
            <Copy className="h-3.5 w-3.5" />
            {t('aiAssistant.copy')}
          </button>
          <button
            aria-label={t('aiAssistant.regenerateResponse')}
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-slate-500 transition hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
            disabled={!canRegenerate}
            onClick={onRegenerate}
            type="button"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t('aiAssistant.regenerate')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  const blocks = splitMarkdownBlocks(sanitizeAssistantText(content));
  return (
    <div className="space-y-2 break-words leading-relaxed">
      {blocks.map((block, index) => {
        if (block.type === 'code') {
          return (
            <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100" key={index}>
              <code>{block.content}</code>
            </pre>
          );
        }
        if (isMarkdownTable(block.content)) {
          return <MarkdownTable content={block.content} key={index} />;
        }
        if (isMarkdownList(block.content)) {
          return <MarkdownList content={block.content} key={index} />;
        }
        return block.content.split(/\n{2,}/).map((paragraph, paragraphIndex) => (
          <p className="whitespace-pre-wrap" key={`${index}-${paragraphIndex}`}>{stripInlineMarkdown(paragraph)}</p>
        ));
      })}
    </div>
  );
}

function MarkdownTable({ content }: { content: string }) {
  const rows = content.split('\n').filter((line) => line.includes('|'));
  const filteredRows = rows.filter((line) => !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line));
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="min-w-full text-xs">
        <tbody>
          {filteredRows.map((row, index) => {
            const cells = row.split('|').map((cell) => stripInlineMarkdown(cell.trim())).filter(Boolean);
            const isHeader = index === 0;
            return (
              <tr className={isHeader ? 'bg-slate-50 font-semibold dark:bg-slate-950' : 'border-t border-slate-200 dark:border-slate-800'} key={`${row}-${index}`}>
                {cells.map((cell, cellIndex) => {
                  const className = 'px-3 py-2 text-start align-top';
                  return isHeader ? <th className={className} key={`${cell}-${cellIndex}`}>{cell}</th> : <td className={className} key={`${cell}-${cellIndex}`}>{cell}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MarkdownList({ content }: { content: string }) {
  const items = content
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*]|â€¢)\s+/, '').trim())
    .filter(Boolean);
  return (
    <ul className="ms-4 list-disc space-y-1">
      {items.map((item, index) => <li key={`${item}-${index}`}>{stripInlineMarkdown(item)}</li>)}
    </ul>
  );
}

function ResultCard({ execution }: { execution: ExecutionResult }) {
  const { t } = useTranslation();
  if (execution.type === 'pending_action') return null;
  const result = execution.result;
  if (Array.isArray(result)) {
    if (!result.length) {
      return (
        <div className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/50">
          {t('aiAssistant.emptyResults')}
        </div>
      );
    }
    return (
      <div className="mt-3 space-y-2">
        {result.slice(0, 5).map((item, index) => <StructuredItemCard item={item} key={index} toolName={execution.toolName} />)}
        {result.length > 5 ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/50">
            {t('aiAssistant.moreResults', { count: result.length - 5 })}
          </p>
        ) : null}
      </div>
    );
  }
  if (result && typeof result === 'object') {
    return <StructuredItemCard item={result} toolName={execution.toolName} />;
  }
  return null;
}

function StructuredItemCard({ item, toolName }: { item: unknown; toolName?: string }) {
  const { t, i18n } = useTranslation();
  const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
  const timeEntryToken = ['time', 'sheet'].join('');
  const isInvoice = Boolean(toolName?.includes('invoice') || record.invoiceNumber);
  const isTimesheet = Boolean(toolName?.includes(timeEntryToken) || record.activityType || record.durationMinutes);
  const isPdf = Boolean(toolName === 'generate_invoice_pdf' || record.downloadEndpoint);
  const isClient = Boolean(toolName?.includes('client') || record.company || record.email);
  let icon = <BriefcaseBusiness className="h-4 w-4" />;
  if (isPdf) icon = <FileText className="h-4 w-4" />;
  else if (isInvoice) icon = <ReceiptText className="h-4 w-4" />;
  else if (isTimesheet) icon = <Clock3 className="h-4 w-4" />;
  else if (isClient) icon = <UserRound className="h-4 w-4" />;

  const title = businessTitle(record, t);
  const subtitle = businessSubtitle(record, t, i18n.language);
  const statusValue = formatBusinessValue('status', record.status ?? record.signatureStatus ?? record.success, t, i18n.language);
  const details = businessDetailEntries(record, t, i18n.language);
  const downloadEndpoint = typeof record.downloadEndpoint === 'string' && record.downloadEndpoint.startsWith('/api/') ? record.downloadEndpoint : '';
  return (
    <article className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-sm dark:border-slate-800 dark:bg-slate-950/50">
      {isPdf ? (
        <div className="border-b border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
          {t('aiAssistant.pdfReady')}
        </div>
      ) : null}
      <div className="p-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-950 dark:text-slate-50" title={title}>{title}</p>
          {subtitle ? <p className="truncate text-xs text-slate-500">{subtitle}</p> : null}
        </div>
        {statusValue !== '-' ? <StatusPill value={statusValue} /> : null}
      </div>
      {details.length ? (
        <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          {details.map(([key, value]) => (
            <div className="min-w-0 rounded-md bg-white p-2 dark:bg-slate-900" key={key}>
              <dt className="truncate font-medium text-slate-500">{businessFieldLabel(key, t)}</dt>
              <dd className="mt-1 min-w-0 truncate text-slate-900 dark:text-slate-100" title={formatBusinessValue(key, value, t, i18n.language)}>
                {key.toLowerCase().includes('status') || key.toLowerCase() === 'success'
                  ? <StatusPill value={formatBusinessValue(key, value, t, i18n.language)} />
                  : formatBusinessValue(key, value, t, i18n.language)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {isWorkflowRecord(record) ? <WorkflowPlan workflow={record.workflow as Record<string, unknown>} /> : null}
      {downloadEndpoint ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
          <a
            className="inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-xs font-semibold text-white transition hover:bg-primary/90 focus:outline-none focus:ring-4 focus:ring-primary/20"
            href={downloadEndpoint}
            rel="noreferrer"
            target="_blank"
          >
            <Eye className="h-3.5 w-3.5" />
            {t('aiAssistant.cardActions.previewPdf')}
          </a>
          <a
            className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            download
            href={downloadEndpoint}
          >
            <Download className="h-3.5 w-3.5" />
            {t('aiAssistant.cardActions.downloadPdf')}
          </a>
        </div>
      ) : null}
      </div>
    </article>
  );
}

function StatusPill({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  let classes = 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200';
  if (['active', 'approved', 'paid', 'success', 'invoiced'].some((item) => normalized.includes(item))) {
    classes = 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300';
  } else if (['draft', 'pending', 'submitted', 'sent'].some((item) => normalized.includes(item))) {
    classes = 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300';
  } else if (['reject', 'cancel', 'failed', 'error'].some((item) => normalized.includes(item))) {
    classes = 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300';
  }
  return <span className={`inline-flex max-w-full rounded-full px-2 py-0.5 text-[11px] font-semibold ${classes}`}>{value}</span>;
}

function PendingActionCard({ action, disabled, onCancel, onConfirm, onModify }: {
  action: AiPendingAction;
  disabled: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onModify: () => void;
}) {
  const { t, i18n } = useTranslation();
  const preview = normalizePreview(action.previewPayload);
  const title = friendlyActionTitle(action.toolName, preview.title, t);
  const summaryEntries = businessDetailEntries(preview.summary, t, i18n.language, 10);
  return (
    <article className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/70 text-amber-700 dark:bg-slate-950/50">
          <FileText className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{title}</p>
          <p className="mt-1 text-xs opacity-80">{preview.description || t('aiAssistant.requiresConfirmation')}</p>
        </div>
      </div>
      {summaryEntries.length ? (
        <dl className="mt-3 grid gap-2 rounded-lg bg-white/60 p-2 text-xs dark:bg-slate-950/40">
          {summaryEntries.map(([key, value]) => (
            <div className="grid grid-cols-[minmax(96px,140px)_minmax(0,1fr)] gap-2" key={key}>
              <dt className="truncate font-medium text-slate-500 dark:text-slate-400">{businessFieldLabel(key, t)}</dt>
              <dd className="min-w-0 break-words text-slate-800 dark:text-slate-100">{formatBusinessValue(key, value, t, i18n.language)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {isWorkflowRecord(preview.summary) ? <WorkflowPlan workflow={preview.summary.workflow as Record<string, unknown>} /> : null}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" disabled={disabled} onClick={onCancel} type="button">
          {t('common.cancel')}
        </button>
        <button className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" disabled={disabled} onClick={onModify} type="button">
          {t('aiAssistant.modify')}
        </button>
        <button className="inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-xs font-semibold text-white transition hover:bg-primary/90 disabled:opacity-60" disabled={disabled} onClick={onConfirm} type="button">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {t('common.confirm')}
        </button>
      </div>
    </article>
  );
}

function PendingActionEditDialog({ action, disabled, onClose, onSave }: {
  action: AiPendingAction;
  disabled: boolean;
  onClose: () => void;
  onSave: (input: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>(() => stringifyEditableInput(action.inputPayload));
  const entries = Object.entries(values).filter(([key]) => isEditableAiField(key));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave(parseEditableInput(action.inputPayload, values));
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="ai-action-edit-title">
      <form className="max-h-[88vh] w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950" onSubmit={submit}>
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <div>
            <h3 id="ai-action-edit-title" className="text-base font-semibold text-slate-950 dark:text-slate-50">{t('aiAssistant.editPreview')}</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('aiAssistant.editPreviewText')}</p>
          </div>
          <button className="rounded-md p-2 text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-900" onClick={onClose} type="button" aria-label={t('common.close')}>
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="max-h-[58vh] space-y-3 overflow-y-auto p-4">
          {entries.length ? entries.map(([key, value]) => (
            <label className="block" key={key}>
              <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">{businessFieldLabel(key, t)}</span>
              {typeof (action.inputPayload as Record<string, unknown>)?.[key] === 'boolean' ? (
                <select
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                  disabled={disabled}
                  onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
                  value={value}
                >
                  <option value="true">{t('common.yes')}</option>
                  <option value="false">{t('common.no')}</option>
                </select>
              ) : (
                <input
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                  disabled={disabled}
                  onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
                  value={value}
                />
              )}
            </label>
          )) : (
            <p className="text-sm text-slate-500">{t('aiAssistant.noEditableFields')}</p>
          )}
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-200 p-4 dark:border-slate-800">
          <button className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" disabled={disabled} onClick={onClose} type="button">
            {t('common.cancel')}
          </button>
          <button className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:opacity-60" disabled={disabled || !entries.length} type="submit">
            {disabled ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {t('aiAssistant.regeneratePreview')}
          </button>
        </footer>
      </form>
    </div>
  );
}

function getExecutionResult(message: AiMessage): ExecutionResult | null {
  const metadata = message.metadata;
  if (!metadata || typeof metadata !== 'object') return null;
  const executionResult = (metadata as Record<string, unknown>).executionResult;
  if (!executionResult || typeof executionResult !== 'object') return null;
  return executionResult as ExecutionResult;
}

function normalizePreview(value: unknown): { title: string; description: string; summary: Record<string, unknown> } {
  if (!value || typeof value !== 'object') return { title: '', description: '', summary: {} };
  const record = value as Record<string, unknown>;
  return {
    title: typeof record.title === 'string' ? record.title : '',
    description: typeof record.description === 'string' ? record.description : '',
    summary: record.summary && typeof record.summary === 'object' ? record.summary as Record<string, unknown> : {},
  };
}

function friendlyActionTitle(toolName: string, previewTitle: string, t: Translate): string {
  const knownTitles: Record<string, string> = {
    create_timesheet: t('aiAssistant.actions.createTimesheet'),
    update_draft_timesheet: t('aiAssistant.actions.updateTimesheet'),
    submit_timesheet: t('aiAssistant.actions.submitTimesheet'),
    approve_timesheet: t('aiAssistant.actions.approveTimesheet'),
    reject_timesheet: t('aiAssistant.actions.rejectTimesheet'),
    generate_invoice_from_timesheets: t('aiAssistant.actions.generateInvoice'),
    send_invoice_email: t('aiAssistant.actions.sendInvoiceEmail'),
    generate_invoice_pdf: t('aiAssistant.actions.generateInvoicePdf'),
    prepare_invoice_preview: t('aiAssistant.actions.prepareInvoice'),
  };
  return knownTitles[toolName] || previewTitle || t('aiAssistant.preview');
}

function splitMarkdownBlocks(content: string): Array<{ type: 'text' | 'code'; content: string }> {
  const blocks: Array<{ type: 'text' | 'code'; content: string }> = [];
  const parts = content.split(/```/g);
  parts.forEach((part, index) => {
    const trimmed = part.replace(/^\w+\n/, '').trim();
    if (!trimmed) return;
    blocks.push({ type: index % 2 === 1 ? 'code' : 'text', content: trimmed });
  });
  return blocks.length ? blocks : [{ type: 'text', content }];
}

function isMarkdownTable(content: string): boolean {
  const lines = content.split('\n').filter(Boolean);
  return lines.length > 1 && lines.some((line) => /\|\s*:?-{3,}:?\s*\|/.test(line));
}

function isMarkdownList(content: string): boolean {
  const lines = content.split('\n').filter(Boolean);
  return lines.length > 1 && lines.every((line) => /^\s*(?:[-*]|•)\s+/.test(line));
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

function sanitizeAssistantText(content: string): string {
  return content
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '...')
    .replace(/\/api\/[^\s)]+/g, '')
    .replace(/\b[a-z]+_[a-z0-9_]+\(\)/gi, '')
    .replace(/\b[a-z]+_[a-z0-9_]+\b(?=\s*(?:tool|function|payload|json))/gi, '')
    .trim();
}

function businessTitle(record: Record<string, unknown>, t: Translate): string {
  if (record.downloadEndpoint && record.invoiceNumber) return t('aiAssistant.pdfTitle', { number: readable(record.invoiceNumber, t) });
  return readable(
    record.contractNumber
      ?? record.invoiceNumber
      ?? record.creditNoteNumber
      ?? record.devisNumber
      ?? record.expenseNumber
      ?? record.documentNumber
      ?? record.title
      ?? record.name
      ?? record.employee
      ?? t('aiAssistant.result'),
    t
  );
}

function businessSubtitle(record: Record<string, unknown>, t: Translate, locale: string): string {
  const client = formatBusinessValue('client', record.client ?? record.customer, t, locale);
  if (client !== '-') return client;
  const period = record.billingPeriod && typeof record.billingPeriod === 'object'
    ? record.billingPeriod as Record<string, unknown>
    : null;
  if (period?.start || period?.end) {
    return `${formatBusinessValue('start', period.start, t, locale)} - ${formatBusinessValue('end', period.end, t, locale)}`;
  }
  return formatBusinessValue('email', record.email ?? record.status ?? '', t, locale);
}

function businessDetailEntries(
  record: Record<string, unknown>,
  t: Translate,
  locale: string,
  limit = 6
): Array<[string, unknown]> {
  const hidden = new Set([
    'contractNumber',
    'invoiceNumber',
    'creditNoteNumber',
    'devisNumber',
    'expenseNumber',
    'documentNumber',
    'title',
    'name',
    'email',
    'client',
    'customer',
    'downloadEndpoint',
    'readyTimesheets',
    'workflow',
  ]);
  return Object.entries(record)
    .filter(([key, value]) => !hidden.has(key) && isPublicResultField(key) && formatBusinessValue(key, value, t, locale) !== '-')
    .sort(([left], [right]) => businessFieldPriority(left) - businessFieldPriority(right))
    .slice(0, limit);
}

function WorkflowPlan({ workflow }: { workflow: Record<string, unknown> }) {
  const { t } = useTranslation();
  const steps = Array.isArray(workflow.steps) ? workflow.steps.filter((step): step is Record<string, unknown> => Boolean(step && typeof step === 'object')) : [];
  if (!steps.length) return null;
  return (
    <section className="mt-3 rounded-lg border border-slate-200 bg-white/70 p-3 dark:border-slate-800 dark:bg-slate-950/40">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase text-slate-500">{t('aiAssistant.workflowPlan')}</p>
        <StatusPill value={formatBusinessValue('status', workflow.status, t, 'en')} />
      </div>
      <ol className="mt-3 space-y-2">
        {steps.map((step, index) => {
          const status = typeof step.status === 'string' ? step.status : 'PENDING';
          const isDone = status === 'COMPLETED';
          const isFailed = status === 'FAILED';
          const StepIcon = isDone ? CheckCircle2 : isFailed ? X : Clock3;
          return (
            <li className="flex items-start gap-2 text-xs" key={`${String(step.key ?? index)}-${index}`}>
              <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                isDone
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : isFailed
                    ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300'
                    : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900'
              }`}>
                <StepIcon className="h-3 w-3" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-800 dark:text-slate-100" title={String(step.label ?? step.key ?? '')}>
                  {String(step.label ?? step.key ?? t('aiAssistant.workflowStep'))}
                </p>
                <p className="text-[11px] text-slate-500">{translatedStatus(status, t)}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function isWorkflowRecord(record: Record<string, unknown>): boolean {
  return Boolean(record.workflow && typeof record.workflow === 'object' && !Array.isArray(record.workflow));
}

function businessFieldPriority(key: string): number {
  const order = [
    'billingPeriod',
    'approvedBillableTimesheetCount',
    'billableHours',
    'hourlyRate',
    'subtotal',
    'taxRate',
    'taxAmount',
    'estimatedTotal',
    'total',
    'currency',
    'status',
    'issueDate',
    'dueDate',
    'workDate',
  ];
  const index = order.indexOf(key);
  return index === -1 ? 100 : index;
}

function businessFieldLabel(key: string, t: Translate): string {
  const translated = t(`aiAssistant.fields.${key}`);
  if (translated && translated !== `aiAssistant.fields.${key}`) return translated;
  return humanizeKey(key);
}

function formatBusinessValue(
  key: string,
  value: unknown,
  t: Translate,
  locale: string
): string {
  if (value == null || value === '') return '-';
  if (typeof value === 'boolean') return value ? t('common.yes') : t('common.no');
  if (typeof value === 'number') {
    if (isMoneyField(key)) return formatMoney(value, 'MAD', locale);
    if (key.toLowerCase().includes('rate')) return `${new Intl.NumberFormat(locale).format(value)}%`;
    if (key.toLowerCase().includes('minutes')) return formatMinutes(value, t);
    return new Intl.NumberFormat(locale).format(value);
  }
  if (typeof value === 'string') {
    if (isUuid(value)) return shortIdentifier(value);
    if (isIsoDate(value)) return formatDate(value, locale);
    if (key.toLowerCase().includes('email')) return compactEmail(value);
    if (isStatusField(key)) return translatedStatus(value, t);
    if (/^\/api\//.test(value) || value.includes('/api/')) return '-';
    return value;
  }
  if (Array.isArray(value)) return t('aiAssistant.itemsCount', { count: value.length });
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.start || record.end) {
      return `${formatBusinessValue('start', record.start, t, locale)} - ${formatBusinessValue('end', record.end, t, locale)}`;
    }
    return readable(
      record.contractNumber
        ?? record.invoiceNumber
        ?? record.creditNoteNumber
        ?? record.devisNumber
        ?? record.expenseNumber
        ?? record.name
        ?? record.email
        ?? record.title
        ?? t('aiAssistant.result'),
      t
    );
  }
  return String(value);
}

function formatMoney(value: number, currency: string, locale: string): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(value)} ${currency}`;
}

function formatMinutes(value: number, t: Translate): string {
  const hours = value / 60;
  return t('aiAssistant.hoursCount', { count: Number(hours.toFixed(2)) });
}

function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

function translatedStatus(value: string, t: Translate): string {
  const key = `aiAssistant.status.${value}`;
  const translated = t(key);
  return translated && translated !== key ? translated : humanizeKey(value);
}

function isMoneyField(key: string): boolean {
  return /(amount|total|subtotal|rate|balance|price|cost)$/i.test(key) && !/taxRate/i.test(key);
}

function isStatusField(key: string): boolean {
  return /(status|state|success|currency)$/i.test(key);
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(?:T|\b)/.test(value) && !Number.isNaN(new Date(value).getTime());
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function shortIdentifier(value: string): string {
  if (!isUuid(value)) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function compactEmail(value: string): string {
  const [local, domain] = value.split('@');
  if (!domain || local.length <= 14) return value;
  return `${local.slice(0, 12)}...@${domain}`;
}

function readable(value: unknown, t: Translate): string {
  if (value == null || value === '') return '-';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return t('aiAssistant.itemsCount', { count: value.length });
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return readable(record.contractNumber ?? record.invoiceNumber ?? record.creditNoteNumber ?? record.devisNumber ?? record.expenseNumber ?? record.name ?? record.email ?? record.title ?? t('aiAssistant.result'), t);
  }
  return String(value);
}

function isPublicResultField(key: string): boolean {
  const normalized = key.toLowerCase();
  if (['id', 'userid', 'createdbyid', 'updatedbyid', 'clientid', 'customerid', 'contractid', 'invoiceid', 'timesheetid', 'actionid'].includes(normalized)) {
    return false;
  }
  return !/(^|_)(id|hash|token|secret|password|cookie|authorization|metadata|payload)$/i.test(key);
}

function isEditableAiField(key: string): boolean {
  const normalized = key.toLowerCase();
  if (['contractid', 'invoiceid', 'clientid', 'customerid', 'timesheetid', 'idempotencykey'].includes(normalized)) {
    return false;
  }
  return isPublicResultField(key);
}

function humanizeKey(key: string) {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function stringifyEditableInput(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value == null) output[key] = '';
    else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') output[key] = String(value);
  }
  return output;
}

function parseEditableInput(
  original: unknown,
  values: Record<string, string>
): Record<string, unknown> {
  const base = original && typeof original === 'object' && !Array.isArray(original)
    ? original as Record<string, unknown>
    : {};
  const output: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(values)) {
    const originalValue = base[key];
    if (typeof originalValue === 'number') {
      const numericValue = Number(value);
      output[key] = Number.isFinite(numericValue) ? numericValue : value;
    } else if (typeof originalValue === 'boolean') {
      output[key] = value === 'true';
    } else if (value === '') {
      output[key] = null;
    } else {
      output[key] = value;
    }
  }
  return output;
}
