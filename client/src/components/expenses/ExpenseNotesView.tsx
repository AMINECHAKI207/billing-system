import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BarChart3,
  Bot,
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  CircleDollarSign,
  Clock,
  ClipboardCheck,
  Download,
  Edit3,
  Eye,
  FileSpreadsheet,
  FileText,
  Hash,
  KanbanSquare,
  Loader2,
  Mail,
  MoreHorizontal,
  Percent,
  Plus,
  Printer,
  ReceiptText,
  RefreshCcw,
  Save,
  Search,
  Send,
  Sparkles,
  Star,
  SlidersHorizontal,
  Store,
  Tag,
  Trash2,
  Upload,
  X,
  XCircle,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  analyzeExpenseReceipt,
  approveExpenseNote,
  createExpenseCategory,
  createExpenseNote,
  createExpenseType,
  deleteExpenseAttachment,
  deleteExpenseNote,
  downloadExpenseAttachment,
  downloadExpenseNotePdf,
  exportExpenseNotes,
  getExpenseAnalytics,
  getExpenseNoteEmailHistory,
  getExpenseCategories,
  getExpenseNotes,
  getExpenseTypes,
  markExpenseNotePaid,
  previewExpenseNotePdf,
  printExpenseNotePdf,
  rejectExpenseNote,
  requestExpenseNoteChanges,
  sendExpenseNoteEmail,
  submitExpenseNote,
  updateExpenseCategory,
  updateExpenseNote,
  updateExpenseType,
} from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { useConfirm } from '@/hooks/useConfirm';
import { useToast } from '@/hooks/useToast';
import type { ExpenseAnalytics, ExpenseAnalyticsGroup, ExpenseCategory, ExpenseEmailLog, ExpenseNote, ExpenseNoteFilters, ExpenseNoteForm, ExpenseNoteStatus, ExpenseSource, ExpenseType } from '@/types';

type ExpenseDraft = ExpenseNoteForm;
type DrawerStep = 'receipt' | 'analysis' | 'review' | 'submit';
type ExpenseViewMode = 'list' | 'kanban' | 'calendar' | 'analytics';

interface SavedExpenseFilter {
  id: string;
  name: string;
  favorite: boolean;
  filters: Omit<ExpenseNoteFilters, 'page' | 'limit'>;
}

interface ActionMenuPosition {
  left: number;
  top: number;
}

interface ExpenseNotesViewProps {
  hasPermission: (permission: string) => boolean;
  getApiErrorMessage: (error: unknown, fallback: string) => string;
}

const emptyCategories: ExpenseCategory[] = [];
const emptyTypes: ExpenseType[] = [];
const emptyNotes: ExpenseNote[] = [];
const emptySavedFilters: SavedExpenseFilter[] = [];
const savedFiltersStorageKey = 'expense-notes:saved-filters';
const kanbanStatuses: ExpenseNoteStatus[] = ['DRAFT', 'SUBMITTED', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'PAID'];

const workflowStatuses: ExpenseNoteStatus[] = [
  'DRAFT',
  'PROCESSING',
  'NEEDS_REVIEW',
  'SUBMITTED',
  'CHANGES_REQUESTED',
  'APPROVED',
  'REJECTED',
  'PAID',
];

const statusTone: Record<ExpenseNoteStatus, string> = {
  DRAFT: 'bg-slate-50 text-slate-700 ring-slate-200',
  PROCESSING: 'bg-sky-50 text-sky-700 ring-sky-200',
  NEEDS_REVIEW: 'bg-amber-50 text-amber-700 ring-amber-200',
  SUBMITTED: 'bg-blue-50 text-blue-700 ring-blue-200',
  CHANGES_REQUESTED: 'bg-orange-50 text-orange-700 ring-orange-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-700 ring-rose-200',
  PAID: 'bg-violet-50 text-violet-700 ring-violet-200',
};

const auditTone: Record<string, string> = {
  CREATED: 'bg-blue-500 ring-blue-100',
  UPDATED: 'bg-slate-500 ring-slate-100',
  RECEIPT_UPLOADED: 'bg-indigo-500 ring-indigo-100',
  AI_ANALYSIS_COMPLETED: 'bg-purple-500 ring-purple-100',
  AI_ANALYSIS_FAILED: 'bg-purple-500 ring-purple-100',
  SUBMITTED: 'bg-orange-500 ring-orange-100',
  RESUBMITTED: 'bg-orange-500 ring-orange-100',
  APPROVED: 'bg-green-500 ring-green-100',
  REJECTED: 'bg-red-500 ring-red-100',
  CHANGES_REQUESTED: 'bg-amber-500 ring-amber-100',
  PAID: 'bg-emerald-500 ring-emerald-100',
  DELETED: 'bg-red-500 ring-red-100',
};

const defaultDraft = (): ExpenseDraft => ({
  categoryId: '',
  expenseTypeId: '',
  expenseDate: new Date().toISOString().slice(0, 10),
  amountTTC: 0,
  amountHT: 0,
  vatAmount: 0,
  vatRate: 20,
  comment: '',
  merchantName: '',
  receiptNumber: '',
  currency: 'MAD',
  source: 'MANUAL',
});

export function ExpenseNotesView({ hasPermission, getApiErrorMessage }: ExpenseNotesViewProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const actionButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const actionMenuRef = useRef<HTMLDivElement | null>(null);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState<ExpenseSource | ''>('');
  const [statusFilter, setStatusFilter] = useState<ExpenseNoteStatus | ''>('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [currencyFilter, setCurrencyFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [hasReceiptFilter, setHasReceiptFilter] = useState('');
  const [hasWarningsFilter, setHasWarningsFilter] = useState('');
  const [aiConfidenceMin, setAiConfidenceMin] = useState('');
  const [activeViewMode, setActiveViewMode] = useState<ExpenseViewMode>('list');
  const [savedFilters, setSavedFilters] = useState<SavedExpenseFilter[]>(emptySavedFilters);
  const [savedFilterName, setSavedFilterName] = useState('');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerStep, setDrawerStep] = useState<DrawerStep>('receipt');
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState<ExpenseDraft>(defaultDraft);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState('');
  const [receiptPreviewName, setReceiptPreviewName] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [currentReceiptAttachmentId, setCurrentReceiptAttachmentId] = useState('');
  const [receiptZoom, setReceiptZoom] = useState(100);
  const [isDraggingReceipt, setIsDraggingReceipt] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [typeName, setTypeName] = useState('');
  const [typeCategoryId, setTypeCategoryId] = useState('');
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  const [aiConfidence, setAiConfidence] = useState<Record<string, number>>({});
  const [selectedNote, setSelectedNote] = useState<ExpenseNote | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [reasonAction, setReasonAction] = useState<'reject' | 'changes' | ''>('');
  const [actionMenuNoteId, setActionMenuNoteId] = useState('');
  const [actionMenuPosition, setActionMenuPosition] = useState<ActionMenuPosition | null>(null);
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<string[]>([]);
  const [areAdvancedFiltersOpen, setAreAdvancedFiltersOpen] = useState(false);
  const [isManageSectionOpen, setIsManageSectionOpen] = useState(false);
  const [emailNote, setEmailNote] = useState<ExpenseNote | null>(null);
  const [emailForm, setEmailForm] = useState({ to: '', cc: '', bcc: '', subject: '', message: '' });
  const [historyNote, setHistoryNote] = useState<ExpenseNote | null>(null);

  useEffect(() => {
    return () => {
      if (receiptPreviewUrl.startsWith('blob:')) URL.revokeObjectURL(receiptPreviewUrl);
    };
  }, [receiptPreviewUrl]);

  const updateActionMenuPosition = useCallback((noteId = actionMenuNoteId) => {
    if (!noteId) {
      return;
    }

    const button = actionButtonRefs.current.get(noteId);
    if (!button) {
      return;
    }

    const rect = button.getBoundingClientRect();
    const menuWidth = 224;
    const menuHeight = actionMenuRef.current?.offsetHeight ?? 224;
    const viewportPadding = 8;
    const gap = 8;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const shouldOpenUp = spaceBelow < menuHeight + gap + viewportPadding && spaceAbove > spaceBelow;
    const rawTop = shouldOpenUp ? rect.top - menuHeight - gap : rect.bottom + gap;
    const maxTop = Math.max(viewportPadding, window.innerHeight - menuHeight - viewportPadding);
    const top = Math.min(Math.max(rawTop, viewportPadding), maxTop);
    const isRTL = document.documentElement.dir === 'rtl';
    const rawLeft = isRTL ? rect.left : rect.right - menuWidth;
    const maxLeft = Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding);
    const left = Math.min(Math.max(rawLeft, viewportPadding), maxLeft);

    setActionMenuPosition({ left, top });
  }, [actionMenuNoteId]);

  useLayoutEffect(() => {
    if (actionMenuNoteId) {
      updateActionMenuPosition(actionMenuNoteId);
    } else {
      setActionMenuPosition(null);
    }
  }, [actionMenuNoteId, updateActionMenuPosition]);

  useEffect(() => {
    if (!actionMenuNoteId) {
      return;
    }

    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      const button = actionButtonRefs.current.get(actionMenuNoteId);
      if (actionMenuRef.current?.contains(target) || button?.contains(target)) {
        return;
      }

      setActionMenuNoteId('');
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActionMenuNoteId('');
      }
    };
    const reposition = () => updateActionMenuPosition(actionMenuNoteId);

    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);

    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [actionMenuNoteId, updateActionMenuPosition]);

  useEffect(() => {
    if (!actionMenuNoteId || !actionMenuPosition) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      actionMenuRef.current?.querySelector('button')?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [actionMenuNoteId, actionMenuPosition]);

  useEffect(() => {
    if (!isDrawerOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isDrawerOpen]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(savedFiltersStorageKey);
      setSavedFilters(stored ? JSON.parse(stored) as SavedExpenseFilter[] : emptySavedFilters);
    } catch {
      setSavedFilters(emptySavedFilters);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(savedFiltersStorageKey, JSON.stringify(savedFilters));
  }, [savedFilters]);

  const categoriesQuery = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => getExpenseCategories(),
  });

  const typesQuery = useQuery({
    queryKey: ['expense-types'],
    queryFn: () => getExpenseTypes(),
  });

  const currentFilters = useMemo<Omit<ExpenseNoteFilters, 'page' | 'limit'>>(() => ({
    search: search || undefined,
    categoryId: categoryFilter || undefined,
    expenseTypeId: typeFilter || undefined,
    source: sourceFilter || undefined,
    status: statusFilter || undefined,
    employeeId: employeeFilter || undefined,
    amountMin: amountMin || undefined,
    amountMax: amountMax || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    currency: currencyFilter || undefined,
    hasReceipt: hasReceiptFilter ? hasReceiptFilter === 'true' : undefined,
    hasWarnings: hasWarningsFilter ? hasWarningsFilter === 'true' : undefined,
    aiConfidenceMin: aiConfidenceMin || undefined,
  }), [aiConfidenceMin, amountMax, amountMin, categoryFilter, currencyFilter, dateFrom, dateTo, employeeFilter, hasReceiptFilter, hasWarningsFilter, search, sourceFilter, statusFilter, typeFilter]);

  const notesQuery = useQuery({
    queryKey: ['expense-notes', page, currentFilters],
    queryFn: () => getExpenseNotes({
      page,
      limit: 12,
      ...currentFilters,
    }),
  });

  const viewNotesQuery = useQuery({
    queryKey: ['expense-notes-view', currentFilters],
    queryFn: () => getExpenseNotes({ page: 1, limit: 500, ...currentFilters }),
    enabled: activeViewMode === 'kanban' || activeViewMode === 'calendar',
  });

  const analyticsQuery = useQuery({
    queryKey: ['expense-analytics', currentFilters],
    queryFn: () => getExpenseAnalytics(currentFilters),
    enabled: activeViewMode === 'analytics',
  });

  const emailHistoryQuery = useQuery({
    queryKey: ['expense-email-history', historyNote?.id],
    queryFn: () => getExpenseNoteEmailHistory(historyNote!.id),
    enabled: Boolean(historyNote),
  });

  const categories = categoriesQuery.data ?? emptyCategories;
  const types = typesQuery.data ?? emptyTypes;
  const notes = notesQuery.data?.data ?? emptyNotes;
  const documentLanguage = useMemo(() => {
    const language = i18n.resolvedLanguage || i18n.language || 'fr';
    return language.startsWith('ar') ? 'ar' : language.startsWith('en') ? 'en' : 'fr';
  }, [i18n.language, i18n.resolvedLanguage]);
  const exportFilters = currentFilters;
  const employees = useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>();
    notes.forEach((note) => {
      if (note.createdBy?.id && !byId.has(note.createdBy.id)) {
        byId.set(note.createdBy.id, { id: note.createdBy.id, name: note.createdBy.name });
      }
    });

    return Array.from(byId.values());
  }, [notes]);
  const viewNotes = viewNotesQuery.data?.data ?? notes;
  const currencies = useMemo(() => Array.from(new Set([...notes, ...viewNotes].map((note) => note.currency).filter(Boolean))), [notes, viewNotes]);
  const visibleNotes = notes;
  const activeTypesForDraft = useMemo(
    () => types.filter((type) => type.active && type.categoryId === draft.categoryId),
    [draft.categoryId, types]
  );
  const activeTypesForFilter = useMemo(
    () => types.filter((type) => !categoryFilter || type.categoryId === categoryFilter),
    [categoryFilter, types]
  );
  const activeActionNote = useMemo(
    () => visibleNotes.find((note) => note.id === actionMenuNoteId) ?? null,
    [actionMenuNoteId, visibleNotes]
  );
  const selectedNotes = useMemo(
    () => visibleNotes.filter((note) => selectedExpenseIds.includes(note.id)),
    [visibleNotes, selectedExpenseIds]
  );
  const allCurrentPageSelected = visibleNotes.length > 0 && visibleNotes.every((note) => selectedExpenseIds.includes(note.id));
  const pageStart = visibleNotes.length ? (page - 1) * 12 + 1 : 0;
  const pageEnd = visibleNotes.length ? pageStart + visibleNotes.length - 1 : 0;
  const totalNotes = notesQuery.data?.meta.total ?? 0;
  const displayCurrency = visibleNotes[0]?.currency ?? 'MAD';
  const workflowSummary = [
    { key: 'toSubmit', statuses: ['DRAFT', 'NEEDS_REVIEW', 'CHANGES_REQUESTED'] as ExpenseNoteStatus[], filterStatus: 'DRAFT' as ExpenseNoteStatus, label: t('expenses.summary.toSubmit') },
    { key: 'waitingApproval', statuses: ['SUBMITTED'] as ExpenseNoteStatus[], filterStatus: 'SUBMITTED' as ExpenseNoteStatus, label: t('expenses.summary.waitingApproval') },
    { key: 'waitingReimbursement', statuses: ['APPROVED'] as ExpenseNoteStatus[], filterStatus: 'APPROVED' as ExpenseNoteStatus, label: t('expenses.summary.waitingReimbursement') },
    { key: 'paid', statuses: ['PAID'] as ExpenseNoteStatus[], filterStatus: 'PAID' as ExpenseNoteStatus, label: t('expenses.summary.paid') },
  ].map((item) => {
    const matchingNotes = visibleNotes.filter((note) => item.statuses.includes(note.status));
    const amount = matchingNotes.reduce((sum, note) => sum + Number(note.amountTTC), 0);

    return { ...item, amount, count: matchingNotes.length };
  });
  const extractedFieldCount = [
    draft.categoryId,
    draft.expenseTypeId,
    draft.expenseDate,
    draft.merchantName,
    draft.receiptNumber,
    draft.amountHT,
    draft.vatRate,
    draft.vatAmount,
    draft.amountTTC,
    draft.currency,
  ].filter((value) => value !== undefined && value !== null && value !== '').length;
  const missingFieldCount = [
    draft.categoryId,
    draft.expenseTypeId,
    draft.expenseDate,
    draft.amountTTC,
    draft.currency,
  ].filter((value) => !value).length;
  const averageConfidence = useMemo(() => {
    const values = Object.values(aiConfidence);

    if (!values.length) {
      return 0;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }, [aiConfidence]);

  const saveMutation = useMutation({
    mutationFn: (submit: boolean) => editingId ? updateExpenseNote(editingId, draft) : createExpenseNote({ ...draft, submit }),
    onSuccess: () => {
      toast.success(t(editingId ? 'expenses.messages.updated' : 'expenses.messages.created'));
      closeDrawer();
      invalidateExpenses();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('expenses.messages.saveError'))),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteExpenseNote,
    onSuccess: () => {
      toast.success(t('expenses.messages.deleted'));
      invalidateExpenses();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('expenses.messages.deleteError'))),
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: deleteExpenseAttachment,
    onSuccess: () => {
      invalidateExpenses();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('expenses.messages.deleteError'))),
  });

  const analyzeMutation = useMutation({
    mutationFn: analyzeExpenseReceipt,
    onSuccess: (result) => {
      const suggestion = result.suggestedExpense;
      setDraft((current) => ({
        ...current,
        ...suggestion,
        source: 'AI',
        expenseDate: suggestion.expenseDate ?? current.expenseDate,
        categoryId: suggestion.categoryId ?? current.categoryId,
        expenseTypeId: suggestion.expenseTypeId ?? current.expenseTypeId,
        amountTTC: Number(suggestion.amountTTC ?? current.amountTTC),
        amountHT: Number(suggestion.amountHT ?? current.amountHT ?? 0),
        vatAmount: Number(suggestion.vatAmount ?? current.vatAmount),
        vatRate: Number(suggestion.vatRate ?? current.vatRate),
      }));
      setCurrentReceiptAttachmentId(result.attachment.id);
      setAiWarnings(suggestion.warnings ?? []);
      setAiConfidence(suggestion.confidence ?? {});
      setDrawerStep(suggestion.requiresManualReview ? 'review' : 'analysis');
      toast[suggestion.requiresManualReview ? 'warning' : 'success'](
        t(suggestion.requiresManualReview ? 'expenses.messages.manualReview' : 'expenses.messages.analyzed')
      );
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('expenses.messages.analyzeError'))),
  });

  const submitMutation = useMutation({
    mutationFn: (noteId: string) => submitExpenseNote(noteId),
    onSuccess: (note) => {
      toast.success(t('expenses.messages.submitted'));
      setSelectedNote(note);
      invalidateExpenses();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('expenses.messages.submitError'))),
  });

  const approveMutation = useMutation({
    mutationFn: approveExpenseNote,
    onSuccess: (note) => {
      toast.success(t('expenses.messages.approved'));
      setSelectedNote(note);
      invalidateExpenses();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('expenses.messages.approveError'))),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => rejectExpenseNote(id, reason),
    onSuccess: (note) => {
      toast.success(t('expenses.messages.rejected'));
      setReasonAction('');
      setReasonText('');
      setSelectedNote(note);
      invalidateExpenses();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('expenses.messages.rejectError'))),
  });

  const requestChangesMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => requestExpenseNoteChanges(id, reason),
    onSuccess: (note) => {
      toast.success(t('expenses.messages.changesRequested'));
      setReasonAction('');
      setReasonText('');
      setSelectedNote(note);
      invalidateExpenses();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('expenses.messages.changesError'))),
  });

  const paidMutation = useMutation({
    mutationFn: markExpenseNotePaid,
    onSuccess: (note) => {
      toast.success(t('expenses.messages.paid'));
      setSelectedNote(note);
      invalidateExpenses();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('expenses.messages.paidError'))),
  });

  const sendEmailMutation = useMutation({
    mutationFn: (note: ExpenseNote) => sendExpenseNoteEmail(note.id, {
      to: emailForm.to || note.createdBy?.email,
      cc: splitEmailList(emailForm.cc),
      bcc: splitEmailList(emailForm.bcc),
      subject: emailForm.subject || undefined,
      message: emailForm.message || undefined,
      pdfLanguage: documentLanguage,
    }),
    onSuccess: () => {
      toast.success(t('expenses.messages.emailSent'));
      setEmailNote(null);
      setEmailForm({ to: '', cc: '', bcc: '', subject: '', message: '' });
      invalidateExpenses();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('expenses.messages.emailError'))),
  });

  const exportMutation = useMutation({
    mutationFn: (format: 'pdf' | 'zip' | 'excel' | 'csv') => exportExpenseNotes({
      ids: selectedExpenseIds.length ? selectedExpenseIds : undefined,
      filters: selectedExpenseIds.length ? undefined : exportFilters,
      format,
      language: documentLanguage,
    }),
    onSuccess: () => toast.success(t('expenses.messages.exported')),
    onError: (error) => toast.error(getApiErrorMessage(error, t('expenses.messages.exportError'))),
  });

  const categoryMutation = useMutation({
    mutationFn: () => createExpenseCategory({ name: categoryName }),
    onSuccess: () => {
      setCategoryName('');
      toast.success(t('expenses.messages.categoryCreated'));
      queryClient.invalidateQueries({ queryKey: ['expense-categories'] });
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('expenses.messages.categoryError'))),
  });

  const typeMutation = useMutation({
    mutationFn: () => createExpenseType({ categoryId: typeCategoryId, name: typeName }),
    onSuccess: () => {
      setTypeName('');
      toast.success(t('expenses.messages.typeCreated'));
      queryClient.invalidateQueries({ queryKey: ['expense-types'] });
      queryClient.invalidateQueries({ queryKey: ['expense-categories'] });
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('expenses.messages.typeError'))),
  });

  const toggleCategoryMutation = useMutation({
    mutationFn: (category: ExpenseCategory) => updateExpenseCategory(category.id, { active: !category.active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['expense-categories'] }),
    onError: (error) => toast.error(getApiErrorMessage(error, t('expenses.messages.categoryError'))),
  });

  const toggleTypeMutation = useMutation({
    mutationFn: (type: ExpenseType) => updateExpenseType(type.id, { active: !type.active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['expense-types'] }),
    onError: (error) => toast.error(getApiErrorMessage(error, t('expenses.messages.typeError'))),
  });

  function invalidateExpenses() {
    queryClient.invalidateQueries({ queryKey: ['expense-notes'] });
    queryClient.invalidateQueries({ queryKey: ['expense-kpi'] });
  }

  function openCreateDrawer() {
    setEditingId('');
    setDraft(defaultDraft());
    setAiWarnings([]);
    setAiConfidence({});
    setReceiptPreviewUrl('');
    setReceiptPreviewName('');
    setReceiptFile(null);
    setCurrentReceiptAttachmentId('');
    setReceiptZoom(100);
    setDrawerStep('receipt');
    setIsDrawerOpen(true);
  }

  function openEditDrawer(note: ExpenseNote) {
    setEditingId(note.id);
    setDraft({
      categoryId: note.categoryId,
      expenseTypeId: note.expenseTypeId,
      expenseDate: note.expenseDate.slice(0, 10),
      amountTTC: Number(note.amountTTC),
      amountHT: Number(note.amountHT ?? 0),
      vatAmount: Number(note.vatAmount),
      vatRate: Number(note.vatRate),
      comment: note.comment ?? '',
      merchantName: note.merchantName ?? '',
      receiptNumber: note.documentNumber ?? note.receiptNumber ?? '',
      currency: note.currency,
      source: note.source,
    });
    setAiWarnings(note.aiWarnings ?? []);
    setAiConfidence(note.aiConfidence ? { global: note.aiConfidence } : {});
    setReceiptPreviewUrl(note.attachments?.[0]?.fileUrl ?? '');
    setReceiptPreviewName(note.attachments?.[0]?.originalName ?? '');
    setCurrentReceiptAttachmentId(note.attachments?.[0]?.id ?? '');
    setReceiptFile(null);
    setReceiptZoom(100);
    setDrawerStep('review');
    setIsDrawerOpen(true);
  }

  function closeDrawer() {
    setIsDrawerOpen(false);
    setEditingId('');
    setDraft(defaultDraft());
    setAiWarnings([]);
    setAiConfidence({});
    setDrawerStep('receipt');
    setReceiptPreviewUrl('');
    setReceiptPreviewName('');
    setReceiptFile(null);
    setCurrentReceiptAttachmentId('');
    setReceiptZoom(100);
  }

  async function remove(note: ExpenseNote) {
    const accepted = await confirm({
      title: t('expenses.confirm.deleteTitle'),
      description: t('expenses.confirm.deleteDescription'),
      confirmText: t('expenses.actions.delete'),
      cancelText: t('expenses.actions.cancel'),
      variant: 'danger',
    });
    if (accepted) deleteMutation.mutate(note.id);
  }

  async function removeSelected() {
    const accepted = await confirm({
      title: t('expenses.confirm.deleteTitle'),
      description: t('expenses.confirm.deleteDescription'),
      confirmText: t('expenses.actions.delete'),
      cancelText: t('expenses.actions.cancel'),
      variant: 'danger',
    });

    if (!accepted) {
      return;
    }

    selectedNotes.filter(canDeleteExpense).forEach((note) => deleteMutation.mutate(note.id));
    setSelectedExpenseIds([]);
  }

  function submitSelected() {
    selectedNotes
      .filter((note) => ['DRAFT', 'NEEDS_REVIEW', 'CHANGES_REQUESTED'].includes(note.status))
      .forEach((note) => submitMutation.mutate(note.id));
    setSelectedExpenseIds([]);
  }

  function canEditExpense(note: ExpenseNote) {
    if (!hasPermission('expense_notes.update')) return false;
    const isExpenseAdmin = hasPermission('expense_notes.approve') || hasPermission('expense_notes.reject') || hasPermission('expense_notes.mark_paid');
    return isExpenseAdmin ? note.status !== 'PAID' : note.status === 'DRAFT';
  }

  function canDeleteExpense(note: ExpenseNote) {
    if (!hasPermission('expense_notes.delete')) return false;
    const isExpenseAdmin = hasPermission('expense_notes.approve') || hasPermission('expense_notes.reject') || hasPermission('expense_notes.mark_paid');
    return isExpenseAdmin || note.status === 'DRAFT';
  }

  function expenseReference(note: ExpenseNote) {
    return note.documentNumber || note.receiptNumber || `EXP-${note.id.slice(0, 8).toUpperCase()}`;
  }

  async function runDocumentAction(action: () => Promise<void>, successKey: string, errorKey: string) {
    try {
      await action();
      toast.success(t(successKey));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t(errorKey)));
    }
  }

  function openEmailModal(note: ExpenseNote) {
    setEmailNote(note);
    setEmailForm({
      to: note.createdBy?.email ?? '',
      cc: '',
      bcc: '',
      subject: t('expenses.email.defaultSubject', { reference: expenseReference(note) }),
      message: t('expenses.email.defaultMessage'),
    });
  }

  function toggleExpenseSelection(noteId: string) {
    setSelectedExpenseIds((current) => current.includes(noteId) ? current.filter((id) => id !== noteId) : [...current, noteId]);
  }

  function toggleCurrentPageSelection() {
    setSelectedExpenseIds((current) => {
      if (allCurrentPageSelected) {
        return current.filter((id) => !visibleNotes.some((note) => note.id === id));
      }

      return Array.from(new Set([...current, ...visibleNotes.map((note) => note.id)]));
    });
  }

  function submitDraft(event: FormEvent) {
    event.preventDefault();
    saveMutation.mutate(false);
  }

  function submitForApproval() {
    if (editingId) {
      submitMutation.mutate(editingId);
      return;
    }
    saveMutation.mutate(true);
  }

  function onReceiptSelected(file?: File) {
    if (!file) return;
    if (receiptPreviewUrl.startsWith('blob:')) URL.revokeObjectURL(receiptPreviewUrl);
    setReceiptPreviewUrl(URL.createObjectURL(file));
    setReceiptPreviewName(file.name);
    setReceiptFile(file);
    setCurrentReceiptAttachmentId('');
    setReceiptZoom(100);
    setDrawerStep('analysis');
    analyzeMutation.mutate(file);
  }

  function removeReceiptPreview() {
    if (currentReceiptAttachmentId) {
      deleteAttachmentMutation.mutate(currentReceiptAttachmentId);
    }
    if (receiptPreviewUrl.startsWith('blob:')) URL.revokeObjectURL(receiptPreviewUrl);
    setReceiptPreviewUrl('');
    setReceiptPreviewName('');
    setReceiptFile(null);
    setCurrentReceiptAttachmentId('');
    setDraft((current) => ({ ...current, attachmentId: undefined, aiAnalysisId: undefined }));
    setReceiptZoom(100);
    setDrawerStep('receipt');
  }

  function analyzeAgain() {
    if (!receiptFile) {
      return;
    }

    setDrawerStep('analysis');
    analyzeMutation.mutate(receiptFile);
  }

  function onDropReceipt(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDraggingReceipt(false);
    onReceiptSelected(event.dataTransfer.files?.[0]);
  }

  function resetFilters() {
    setSearch('');
    setCategoryFilter('');
    setTypeFilter('');
    setStatusFilter('');
    setSourceFilter('');
    setEmployeeFilter('');
    setAmountMin('');
    setAmountMax('');
    setCurrencyFilter('');
    setDateFrom('');
    setDateTo('');
    setHasReceiptFilter('');
    setHasWarningsFilter('');
    setAiConfidenceMin('');
    setPage(1);
  }

  function applyFilters(filters: Omit<ExpenseNoteFilters, 'page' | 'limit'>) {
    setSearch(filters.search ?? '');
    setCategoryFilter(filters.categoryId ?? '');
    setTypeFilter(filters.expenseTypeId ?? '');
    setStatusFilter(filters.status ?? '');
    setSourceFilter(filters.source ?? '');
    setEmployeeFilter(filters.employeeId ?? '');
    setAmountMin(filters.amountMin ?? '');
    setAmountMax(filters.amountMax ?? '');
    setCurrencyFilter(filters.currency ?? '');
    setDateFrom(filters.dateFrom ?? '');
    setDateTo(filters.dateTo ?? '');
    setHasReceiptFilter(filters.hasReceipt === undefined ? '' : String(filters.hasReceipt));
    setHasWarningsFilter(filters.hasWarnings === undefined ? '' : String(filters.hasWarnings));
    setAiConfidenceMin(filters.aiConfidenceMin ?? '');
    setPage(1);
  }

  function saveCurrentFilter() {
    const name = savedFilterName.trim();
    if (!name) {
      toast.warning(t('expenses.savedFilters.nameRequired'));
      return;
    }
    setSavedFilters((current) => [
      { id: crypto.randomUUID(), name, favorite: false, filters: currentFilters },
      ...current,
    ]);
    setSavedFilterName('');
    toast.success(t('expenses.savedFilters.saved'));
  }

  function renameSavedFilter(filter: SavedExpenseFilter) {
    const name = window.prompt(t('expenses.savedFilters.renamePrompt'), filter.name)?.trim();
    if (!name) return;
    setSavedFilters((current) => current.map((item) => item.id === filter.id ? { ...item, name } : item));
  }

  function toggleSavedFilterFavorite(filterId: string) {
    setSavedFilters((current) => current.map((item) => item.id === filterId ? { ...item, favorite: !item.favorite } : item));
  }

  async function deleteSavedFilter(filter: SavedExpenseFilter) {
    const accepted = await confirm({
      title: t('expenses.savedFilters.deleteTitle'),
      description: t('expenses.savedFilters.deleteDescription', { name: filter.name }),
      confirmText: t('expenses.actions.delete'),
      cancelText: t('expenses.actions.cancel'),
      variant: 'danger',
    });
    if (accepted) setSavedFilters((current) => current.filter((item) => item.id !== filter.id));
  }

  return (
    <section className="mx-auto max-w-[1600px] space-y-3 bg-slate-50/80 p-2 sm:p-3">
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-200 px-3 py-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-primary/40 bg-white px-3 text-sm font-semibold text-primary transition hover:bg-primary/5" onClick={openCreateDrawer} type="button">
              <Upload className="h-4 w-4" />
              {t('expenses.actions.import')}
            </button>
            <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-primary/90" onClick={openCreateDrawer} type="button">
              <Plus className="h-4 w-4" />
              {t('expenses.actions.newShort')}
            </button>
            <div className="mx-1 h-6 w-px bg-slate-200" />
            <div>
              <h1 className="text-lg font-bold tracking-tight text-slate-900">{t('expenses.title')}</h1>
              <p className="text-[11px] text-slate-500">{t('expenses.subtitle', { count: totalNotes })}</p>
            </div>
          </div>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <div className="relative min-w-[220px] flex-1 lg:max-w-[460px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 rtl:left-auto rtl:right-3" />
              <input
                className="h-9 w-full rounded-md border border-slate-200 bg-white pl-9 pr-9 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 rtl:pl-9 rtl:pr-9"
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder={t('expenses.filters.search')}
                value={search}
              />
              {search ? <button className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 rtl:left-2 rtl:right-auto" onClick={() => setSearch('')} type="button"><X className="h-3.5 w-3.5" /></button> : null}
            </div>
            <button className={`inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium transition ${areAdvancedFiltersOpen ? 'border-primary bg-primary/5 text-primary' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`} onClick={() => setAreAdvancedFiltersOpen((value) => !value)} type="button">
              <SlidersHorizontal className="h-4 w-4" />
              {t('expenses.actions.filters')}
            </button>
            <div className="flex rounded-md border border-slate-200 bg-white p-0.5">
              <ViewModeButton active={activeViewMode === 'list'} icon={FileText} label={t('expenses.views.list')} onClick={() => setActiveViewMode('list')} />
              <ViewModeButton active={activeViewMode === 'kanban'} icon={KanbanSquare} label={t('expenses.views.kanban')} onClick={() => setActiveViewMode('kanban')} />
              <ViewModeButton active={activeViewMode === 'calendar'} icon={CalendarRange} label={t('expenses.views.calendar')} onClick={() => setActiveViewMode('calendar')} />
              <ViewModeButton active={activeViewMode === 'analytics'} icon={BarChart3} label={t('expenses.views.analytics')} onClick={() => setActiveViewMode('analytics')} />
            </div>
            {activeViewMode === 'list' ? <div className="flex items-center gap-1 text-sm text-slate-500">
              <span className="min-w-max">{pageStart}-{pageEnd} {t('expenses.pagination.of')} {totalNotes}</span>
              <button className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button"><ChevronLeft className="h-4 w-4" /></button>
              <button className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:opacity-40" disabled={page >= (notesQuery.data?.meta.totalPages ?? 1)} onClick={() => setPage((value) => value + 1)} type="button"><ChevronRight className="h-4 w-4" /></button>
            </div> : null}
          </div>
        </div>

        <div className="grid border-b border-slate-200 bg-slate-50/60 sm:grid-cols-2 lg:grid-cols-4">
          {workflowSummary.map((item, index) => (
            <button className={`group flex items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-white rtl:text-right ${index > 0 ? 'border-t border-slate-200 sm:border-l sm:border-t-0 rtl:sm:border-l-0 rtl:sm:border-r' : ''}`} key={item.key} onClick={() => { setStatusFilter(item.filterStatus); setPage(1); }} type="button">
              <div>
                <p className="text-lg font-bold text-slate-900">{formatCurrency(item.amount, displayCurrency)}</p>
                <p className="text-xs font-semibold text-slate-600">{item.label}</p>
                <p className="text-[11px] text-slate-400">{item.count} {t('expenses.summary.items')}</p>
              </div>
              {index < workflowSummary.length - 1 ? <ChevronRight className="hidden h-5 w-5 text-slate-300 transition group-hover:text-primary lg:block rtl:rotate-180" /> : null}
            </button>
          ))}
        </div>

        {(categoryFilter || typeFilter || statusFilter || sourceFilter || employeeFilter || amountMin || amountMax || currencyFilter || dateFrom || dateTo || hasReceiptFilter || hasWarningsFilter || aiConfidenceMin) ? (
          <div className="flex flex-wrap gap-1.5 border-b border-slate-200 bg-white px-3 py-2">
            {categoryFilter ? <FilterChip label={categories.find((category) => category.id === categoryFilter)?.name ?? t('expenses.filters.allCategories')} onRemove={() => { setCategoryFilter(''); setTypeFilter(''); }} /> : null}
            {typeFilter ? <FilterChip label={types.find((type) => type.id === typeFilter)?.name ?? t('expenses.filters.allTypes')} onRemove={() => setTypeFilter('')} /> : null}
            {statusFilter ? <FilterChip label={t(`expenses.status.workflow.${statusFilter}`)} onRemove={() => setStatusFilter('')} /> : null}
            {sourceFilter ? <FilterChip label={t(sourceFilter === 'AI' ? 'expenses.source.ai' : 'expenses.source.manual')} onRemove={() => setSourceFilter('')} /> : null}
            {employeeFilter ? <FilterChip label={employees.find((employee) => employee.id === employeeFilter)?.name ?? t('expenses.filters.allEmployees')} onRemove={() => setEmployeeFilter('')} /> : null}
            {amountMin ? <FilterChip label={`${t('expenses.filters.amountMin')}: ${amountMin}`} onRemove={() => setAmountMin('')} /> : null}
            {amountMax ? <FilterChip label={`${t('expenses.filters.amountMax')}: ${amountMax}`} onRemove={() => setAmountMax('')} /> : null}
            {currencyFilter ? <FilterChip label={currencyFilter} onRemove={() => setCurrencyFilter('')} /> : null}
            {dateFrom ? <FilterChip label={dateFrom} onRemove={() => setDateFrom('')} /> : null}
            {dateTo ? <FilterChip label={dateTo} onRemove={() => setDateTo('')} /> : null}
            {hasReceiptFilter ? <FilterChip label={t(hasReceiptFilter === 'true' ? 'expenses.filters.hasReceipt' : 'expenses.filters.noReceipt')} onRemove={() => setHasReceiptFilter('')} /> : null}
            {hasWarningsFilter ? <FilterChip label={t(hasWarningsFilter === 'true' ? 'expenses.filters.hasWarnings' : 'expenses.filters.noWarnings')} onRemove={() => setHasWarningsFilter('')} /> : null}
            {aiConfidenceMin ? <FilterChip label={`${t('expenses.filters.aiConfidenceMin')}: ${aiConfidenceMin}%`} onRemove={() => setAiConfidenceMin('')} /> : null}
          </div>
        ) : null}

        {areAdvancedFiltersOpen ? (
        <div className="border-b border-slate-200 bg-white px-3 py-2.5 sm:px-4">
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect label={t('expenses.filters.allCategories')} onChange={(value) => { setCategoryFilter(value); setTypeFilter(''); setPage(1); }} value={categoryFilter}>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </FilterSelect>
            <FilterSelect label={t('expenses.filters.allTypes')} onChange={(value) => { setTypeFilter(value); setPage(1); }} value={typeFilter}>
              {activeTypesForFilter.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
            </FilterSelect>
            <FilterSelect label={t('expenses.filters.allStatuses')} onChange={(value) => { setStatusFilter(value as ExpenseNoteStatus | ''); setPage(1); }} value={statusFilter}>
              {workflowStatuses.map((status) => <option key={status} value={status}>{t(`expenses.status.workflow.${status}`)}</option>)}
            </FilterSelect>
            <FilterSelect label={t('expenses.filters.allSources')} onChange={(value) => { setSourceFilter(value as ExpenseSource | ''); setPage(1); }} value={sourceFilter}>
              <option value="MANUAL">{t('expenses.source.manual')}</option>
              <option value="AI">{t('expenses.source.ai')}</option>
            </FilterSelect>
            <FilterSelect label={t('expenses.filters.allEmployees')} onChange={(value) => { setEmployeeFilter(value); setPage(1); }} value={employeeFilter}>
              {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
            </FilterSelect>
            <input className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm sm:w-[calc(50%-0.25rem)] lg:w-36" onChange={(event) => setDateFrom(event.target.value)} type="date" value={dateFrom} />
            <input className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm sm:w-[calc(50%-0.25rem)] lg:w-36" onChange={(event) => setDateTo(event.target.value)} type="date" value={dateTo} />
            <input className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm sm:w-[calc(50%-0.25rem)] lg:w-32" onChange={(event) => { setAmountMin(event.target.value); setPage(1); }} placeholder={t('expenses.filters.amountMin')} type="number" value={amountMin} />
            <input className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm sm:w-[calc(50%-0.25rem)] lg:w-32" onChange={(event) => { setAmountMax(event.target.value); setPage(1); }} placeholder={t('expenses.filters.amountMax')} type="number" value={amountMax} />
            <FilterSelect label={t('expenses.filters.allCurrencies')} onChange={(value) => { setCurrencyFilter(value); setPage(1); }} value={currencyFilter}>
              {currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
            </FilterSelect>
            <FilterSelect label={t('expenses.filters.receipt')} onChange={(value) => { setHasReceiptFilter(value); setPage(1); }} value={hasReceiptFilter}>
              <option value="true">{t('expenses.filters.hasReceipt')}</option>
              <option value="false">{t('expenses.filters.noReceipt')}</option>
            </FilterSelect>
            <FilterSelect label={t('expenses.filters.warnings')} onChange={(value) => { setHasWarningsFilter(value); setPage(1); }} value={hasWarningsFilter}>
              <option value="true">{t('expenses.filters.hasWarnings')}</option>
              <option value="false">{t('expenses.filters.noWarnings')}</option>
            </FilterSelect>
            <input className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm sm:w-[calc(50%-0.25rem)] lg:w-40" max="100" min="0" onChange={(event) => { setAiConfidenceMin(event.target.value); setPage(1); }} placeholder={t('expenses.filters.aiConfidenceMin')} type="number" value={aiConfidenceMin} />
            <button className="h-10 w-full rounded-md border border-primary/40 bg-white px-3 text-sm font-semibold text-primary transition hover:bg-primary/5 sm:w-auto" onClick={resetFilters} type="button">
              {t('app.text0148')}
            </button>
          </div>
          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50/60 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <input className="h-9 min-w-[180px] flex-1 rounded-md border border-slate-200 bg-white px-3 text-sm" onChange={(event) => setSavedFilterName(event.target.value)} placeholder={t('expenses.savedFilters.namePlaceholder')} value={savedFilterName} />
              <button className="inline-flex h-9 items-center gap-2 rounded-md border border-primary/40 bg-white px-3 text-sm font-medium text-primary hover:bg-primary/5" onClick={saveCurrentFilter} type="button">
                <Save className="h-4 w-4" />
                {t('expenses.savedFilters.save')}
              </button>
            </div>
            {savedFilters.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[...savedFilters].sort((a, b) => Number(b.favorite) - Number(a.favorite)).map((filter) => (
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700" key={filter.id}>
                    <button className={filter.favorite ? 'text-amber-500' : 'text-slate-400'} onClick={() => toggleSavedFilterFavorite(filter.id)} title={t('expenses.savedFilters.favorite')} type="button"><Star className="h-3.5 w-3.5" /></button>
                    <button className="font-medium hover:text-primary" onClick={() => applyFilters(filter.filters)} type="button">{filter.name}</button>
                    <button className="text-slate-400 hover:text-primary" onClick={() => renameSavedFilter(filter)} type="button">{t('expenses.savedFilters.rename')}</button>
                    <button className="text-slate-400 hover:text-rose-600" onClick={() => void deleteSavedFilter(filter)} type="button"><X className="h-3.5 w-3.5" /></button>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        ) : null}

        {activeViewMode === 'list' ? <>
        {selectedExpenseIds.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-primary/5 px-3 py-2 text-sm">
            <span className="font-medium text-primary">{t('expenses.bulk.selected', { count: selectedExpenseIds.length })}</span>
            <div className="flex flex-wrap gap-2">
              {hasPermission('expense_notes.export.excel') ? <button className="inline-flex h-8 items-center gap-2 rounded-md border border-primary/30 bg-white px-3 text-xs font-medium text-primary hover:bg-primary/5" disabled={exportMutation.isPending} onClick={() => exportMutation.mutate('excel')} type="button"><FileSpreadsheet className="h-3.5 w-3.5" />{t('expenses.actions.exportExcel')}</button> : null}
              {hasPermission('expense_notes.pdf.bulk_export') ? <button className="inline-flex h-8 items-center gap-2 rounded-md border border-primary/30 bg-white px-3 text-xs font-medium text-primary hover:bg-primary/5" disabled={exportMutation.isPending} onClick={() => exportMutation.mutate('pdf')} type="button"><FileText className="h-3.5 w-3.5" />{t('expenses.actions.exportPdf')}</button> : null}
              {hasPermission('expense_notes.pdf.bulk_export') ? <button className="inline-flex h-8 items-center gap-2 rounded-md border border-primary/30 bg-white px-3 text-xs font-medium text-primary hover:bg-primary/5" disabled={exportMutation.isPending} onClick={() => exportMutation.mutate('zip')} type="button"><Download className="h-3.5 w-3.5" />{t('expenses.actions.exportZip')}</button> : null}
              {hasPermission('expense_notes.submit') ? <button className="inline-flex h-8 items-center gap-2 rounded-md border border-primary/30 bg-white px-3 text-xs font-medium text-primary hover:bg-primary/5" onClick={submitSelected} type="button"><Send className="h-3.5 w-3.5" />{t('expenses.actions.submit')}</button> : null}
              {selectedNotes.some(canDeleteExpense) ? <button className="inline-flex h-8 items-center gap-2 rounded-md border border-rose-200 bg-white px-3 text-xs font-medium text-rose-600 hover:bg-rose-50" onClick={removeSelected} type="button"><Trash2 className="h-3.5 w-3.5" />{t('expenses.actions.delete')}</button> : null}
              <button className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50" onClick={() => setSelectedExpenseIds([])} type="button">{t('expenses.actions.cancel')}</button>
            </div>
          </div>
        ) : null}

        <div className="max-h-[640px] overflow-auto">
          <table className="min-w-[1000px] w-full divide-y divide-slate-200 text-sm">
            <thead className="sticky top-0 z-10 bg-white text-left text-xs font-bold uppercase text-slate-600 shadow-[0_1px_0_0_rgba(148,163,184,0.45)] rtl:text-right">
              <tr>
                <th className="w-10 px-3 py-2.5">
                  <input aria-label={t('expenses.bulk.selectAll')} checked={allCurrentPageSelected} className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary" onChange={toggleCurrentPageSelection} type="checkbox" />
                </th>
                <th className="px-3 py-2.5">{t('expenses.fields.receipt')}</th>
                <th className="px-3 py-2.5">{t('expenses.fields.employee')}</th>
                <th className="px-3 py-2.5">{t('expenses.fields.merchant')}</th>
                <th className="px-3 py-2.5">{t('expenses.fields.date')}</th>
                <th className="hidden px-3 py-2.5 lg:table-cell">{t('expenses.fields.category')}</th>
                <th className="hidden px-3 py-2.5 xl:table-cell">{t('expenses.fields.source')}</th>
                <th className="hidden px-3 py-2.5 xl:table-cell">{t('expenses.fields.activity')}</th>
                <th className="px-3 py-2.5 text-right rtl:text-left">{t('expenses.fields.amountTTC')}</th>
                <th className="px-3 py-2.5">{t('expenses.fields.status')}</th>
                <th className="px-3 py-2.5 text-right rtl:text-left">{t('expenses.fields.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {notesQuery.isLoading ? (
                Array.from({ length: 6 }).map((_, index) => <SkeletonRow key={index} />)
              ) : visibleNotes.length ? visibleNotes.map((note) => (
                <tr className="transition hover:bg-blue-50/40" key={note.id}>
                  <td className="px-3 py-2.5">
                    <input aria-label={note.merchantName || t('expenses.empty.merchant')} checked={selectedExpenseIds.includes(note.id)} className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary" onChange={() => toggleExpenseSelection(note.id)} type="checkbox" />
                  </td>
                  <td className="px-3 py-2.5">
                    <button className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50 text-slate-500 shadow-sm transition hover:border-primary/40" onClick={() => setSelectedNote(note)} type="button">
                      {note.attachments?.[0]?.mimeType?.startsWith('image/') ? <img alt="" className="h-full w-full object-cover" src={note.attachments[0].fileUrl} /> : <FileText className="h-5 w-5" />}
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-slate-700">
                    <span className="block max-w-[150px] truncate" title={note.createdBy?.name ?? '-'}>{note.createdBy?.name ?? '-'}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="max-w-[220px] truncate font-medium text-slate-900" title={note.merchantName || t('expenses.empty.merchant')}>{note.merchantName || t('expenses.empty.merchant')}</p>
                    <p className="text-xs text-slate-500">{note.documentNumber || note.receiptNumber || '-'}</p>
                  </td>
                  <td className="px-3 py-2.5 text-slate-700">{new Date(note.expenseDate).toLocaleDateString()}</td>
                  <td className="hidden px-3 py-2.5 text-slate-700 lg:table-cell">
                    <span className="block max-w-[220px] truncate" title={`${note.category?.name ?? ''} / ${note.expenseType?.name ?? ''}`}>{note.category?.name} / {note.expenseType?.name}</span>
                  </td>
                  <td className="hidden px-3 py-2.5 xl:table-cell">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${note.source === 'AI' ? 'bg-violet-50 text-violet-700 ring-violet-200' : 'bg-slate-50 text-slate-700 ring-slate-200'}`}>
                      {t(note.source === 'AI' ? 'expenses.source.ai' : 'expenses.source.manual')}
                    </span>
                  </td>
                  <td className="hidden px-3 py-2.5 xl:table-cell">
                    <button
                      aria-label={t('expenses.activity.tooltip', { count: note.auditLogs?.length ?? 0 })}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600 transition hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
                      onClick={() => setSelectedNote(note)}
                      title={t('expenses.activity.tooltip', { count: note.auditLogs?.length ?? 0 })}
                      type="button"
                    >
                      <Clock className="h-3.5 w-3.5" />
                      <span>{note.auditLogs?.length ?? 0}</span>
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-slate-900 rtl:text-left">{formatCurrency(Number(note.amountTTC), note.currency)}</td>
                  <td className="px-3 py-2.5"><StatusBadge status={note.status} t={t} /></td>
                  <td className="px-3 py-2.5 text-right rtl:text-left">
                    <div className="relative inline-block">
                      <button
                        aria-expanded={actionMenuNoteId === note.id}
                        aria-haspopup="menu"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-primary transition hover:border-primary/20 hover:bg-primary/5 focus:border-primary/40 focus:bg-primary/5 focus:outline-none"
                        onClick={() => {
                          setActionMenuNoteId((current) => {
                            if (current === note.id) {
                              return '';
                            }

                            updateActionMenuPosition(note.id);
                            return note.id;
                          });
                        }}
                        ref={(element) => {
                          if (element) {
                            actionButtonRefs.current.set(note.id, element);
                          } else {
                            actionButtonRefs.current.delete(note.id);
                          }
                        }}
                        type="button"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td className="px-4 py-10 text-center" colSpan={10}>
                    <div className="mx-auto max-w-sm">
                      <ReceiptText className="mx-auto h-10 w-10 text-slate-300" />
                      <h3 className="mt-3 text-sm font-semibold text-slate-900">{t('expenses.empty.title')}</h3>
                      <p className="mt-1 text-sm text-slate-500">{t('expenses.empty.notes')}</p>
                      <button className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white" onClick={openCreateDrawer} type="button">
                        <Plus className="h-4 w-4" />{t('expenses.actions.new')}
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </> : null}

        {activeViewMode === 'kanban' ? <KanbanView notes={viewNotes} onOpen={setSelectedNote} t={t} /> : null}
        {activeViewMode === 'calendar' ? <CalendarView notes={viewNotes} onOpen={setSelectedNote} t={t} /> : null}
        {activeViewMode === 'analytics' ? <AnalyticsView analytics={analyticsQuery.data} currency={displayCurrency} isLoading={analyticsQuery.isLoading} t={t} /> : null}

      </div>

      {activeActionNote && actionMenuPosition ? createPortal(
        <div
          aria-orientation="vertical"
          className="fixed z-[60] w-56 overflow-hidden rounded-md border border-slate-200 bg-white py-1 text-left shadow-lg rtl:text-right"
          ref={actionMenuRef}
          role="menu"
          style={{ left: actionMenuPosition.left, top: actionMenuPosition.top }}
        >
          <ActionItem icon={Eye} label={t('expenses.actions.review')} onClick={() => { setSelectedNote(activeActionNote); setActionMenuNoteId(''); }} />
          {hasPermission('expense_notes.pdf.preview') ? <ActionItem icon={FileText} label={t('expenses.actions.previewPdf')} onClick={() => { void runDocumentAction(() => previewExpenseNotePdf(activeActionNote.id, documentLanguage), 'expenses.messages.pdfPreviewed', 'expenses.messages.pdfError'); setActionMenuNoteId(''); }} /> : null}
          {hasPermission('expense_notes.pdf.download') ? <ActionItem icon={Download} label={t('expenses.actions.downloadPdf')} onClick={() => { void runDocumentAction(() => downloadExpenseNotePdf(activeActionNote.id, expenseReference(activeActionNote), documentLanguage), 'expenses.messages.pdfDownloaded', 'expenses.messages.pdfError'); setActionMenuNoteId(''); }} /> : null}
          {hasPermission('expense_notes.pdf.print') ? <ActionItem icon={Printer} label={t('expenses.actions.printPdf')} onClick={() => { void runDocumentAction(() => printExpenseNotePdf(activeActionNote.id, documentLanguage), 'expenses.messages.pdfPrinted', 'expenses.messages.pdfError'); setActionMenuNoteId(''); }} /> : null}
          {hasPermission('expense_notes.email.send') ? <ActionItem icon={Mail} label={t('expenses.actions.sendEmail')} onClick={() => { openEmailModal(activeActionNote); setActionMenuNoteId(''); }} /> : null}
          {hasPermission('expense_notes.email.history') ? <ActionItem icon={Clock} label={t('expenses.actions.emailHistory')} onClick={() => { setHistoryNote(activeActionNote); setActionMenuNoteId(''); }} /> : null}
          {hasPermission('expense_notes.export.excel') ? <ActionItem icon={FileSpreadsheet} label={t('expenses.actions.exportExcel')} onClick={() => { void runDocumentAction(() => exportExpenseNotes({ ids: [activeActionNote.id], format: 'excel', language: documentLanguage }), 'expenses.messages.exported', 'expenses.messages.exportError'); setActionMenuNoteId(''); }} /> : null}
          {canEditExpense(activeActionNote) ? <ActionItem icon={Edit3} label={t('expenses.actions.update')} onClick={() => { openEditDrawer(activeActionNote); setActionMenuNoteId(''); }} /> : null}
          {hasPermission('expense_notes.submit') && ['DRAFT', 'NEEDS_REVIEW', 'CHANGES_REQUESTED'].includes(activeActionNote.status) ? <ActionItem icon={Send} label={t('expenses.actions.submit')} onClick={() => { submitMutation.mutate(activeActionNote.id); setActionMenuNoteId(''); }} /> : null}
          {activeActionNote.attachments?.[0] ? <ActionItem icon={Download} label={t('expenses.actions.downloadReceipt')} onClick={() => { downloadExpenseAttachment(activeActionNote.attachments![0]!.id); setActionMenuNoteId(''); }} /> : null}
          {canDeleteExpense(activeActionNote) ? <ActionItem danger icon={Trash2} label={t('expenses.actions.delete')} onClick={() => { remove(activeActionNote); setActionMenuNoteId(''); }} /> : null}
        </div>,
        document.body
      ) : null}

      {selectedNote ? (
        <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="xl:sticky xl:top-4 xl:self-start">
            <ReceiptPreview
              alt={selectedNote.attachments?.[0]?.originalName ?? t('expenses.fields.receipt')}
              fileUrl={selectedNote.attachments?.[0]?.fileUrl ?? ''}
              mimeType={selectedNote.attachments?.[0]?.mimeType}
              onZoomIn={() => setReceiptZoom((value) => Math.min(value + 10, 160))}
              onZoomOut={() => setReceiptZoom((value) => Math.max(value - 10, 60))}
              title={t('expenses.review.receiptPreview')}
              zoom={receiptZoom}
            />
          </div>
          <div className="min-w-0">
            <div className="mb-3 flex flex-col gap-2 border-b border-slate-200 pb-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{t('expenses.review.title')}</h2>
                <p className="text-xs text-slate-500">{selectedNote.createdBy?.name} - {selectedNote.createdBy?.email}</p>
              </div>
              <StatusBadge status={selectedNote.status} t={t} />
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <InfoRow label={t('expenses.fields.merchant')} value={selectedNote.merchantName || '-'} />
              <InfoRow label={t('expenses.fields.amountTTC')} value={formatCurrency(Number(selectedNote.amountTTC), selectedNote.currency)} />
              <InfoRow label={t('expenses.fields.vatAmount')} value={formatCurrency(Number(selectedNote.vatAmount), selectedNote.currency)} />
              <InfoRow label={t('expenses.fields.source')} value={t(selectedNote.source === 'AI' ? 'expenses.source.ai' : 'expenses.source.manual')} />
              {selectedNote.rejectionReason ? <InfoRow label={t('expenses.review.rejectionReason')} value={selectedNote.rejectionReason} /> : null}
              {selectedNote.changesRequestedReason ? <InfoRow label={t('expenses.review.changesReason')} value={selectedNote.changesRequestedReason} /> : null}
            </div>
            <Timeline note={selectedNote} t={t} />
            {reasonAction ? (
              <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
                <textarea className="min-h-24 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm" onChange={(event) => setReasonText(event.target.value)} placeholder={t(reasonAction === 'reject' ? 'expenses.review.rejectPlaceholder' : 'expenses.review.changesPlaceholder')} value={reasonText} />
                <div className="mt-2 flex justify-end gap-2">
                  <button className="h-8 rounded-md border border-slate-200 px-3 text-xs" onClick={() => { setReasonAction(''); setReasonText(''); }} type="button">{t('expenses.actions.cancel')}</button>
                  <button className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-white disabled:opacity-50" disabled={reasonText.trim().length < 3} onClick={() => reasonAction === 'reject' ? rejectMutation.mutate({ id: selectedNote.id, reason: reasonText }) : requestChangesMutation.mutate({ id: selectedNote.id, reason: reasonText })} type="button">{t('expenses.actions.confirm')}</button>
                </div>
              </div>
            ) : null}
            <div className="sticky bottom-0 mt-3 flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-white py-2.5">
              {selectedNote.attachments?.[0] ? <button className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm" onClick={() => downloadExpenseAttachment(selectedNote.attachments![0]!.id)} type="button"><Download className="h-4 w-4" />{t('expenses.actions.downloadReceipt')}</button> : null}
              {hasPermission('expense_notes.approve') && selectedNote.status === 'SUBMITTED' ? <button className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white" onClick={() => approveMutation.mutate(selectedNote.id)} type="button"><CheckCircle2 className="h-4 w-4" />{t('expenses.actions.approve')}</button> : null}
              {hasPermission('expense_notes.reject') && selectedNote.status === 'SUBMITTED' ? <button className="inline-flex h-9 items-center gap-2 rounded-md bg-rose-600 px-3 text-sm font-medium text-white" onClick={() => setReasonAction('reject')} type="button"><XCircle className="h-4 w-4" />{t('expenses.actions.reject')}</button> : null}
              {hasPermission('expense_notes.request_changes') && selectedNote.status === 'SUBMITTED' ? <button className="inline-flex h-9 items-center gap-2 rounded-md border border-amber-200 px-3 text-sm text-amber-700" onClick={() => setReasonAction('changes')} type="button"><Clock className="h-4 w-4" />{t('expenses.actions.requestChanges')}</button> : null}
              {hasPermission('expense_notes.mark_paid') && selectedNote.status === 'APPROVED' ? <button className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white" onClick={() => paidMutation.mutate(selectedNote.id)} type="button"><CheckCircle2 className="h-4 w-4" />{t('expenses.actions.markPaid')}</button> : null}
            </div>
          </div>
        </div>
      ) : null}

      {emailNote ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-xl rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{t('expenses.email.title')}</h2>
                <p className="text-xs text-slate-500">{expenseReference(emailNote)}</p>
              </div>
              <button className="rounded-md border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" onClick={() => setEmailNote(null)} type="button"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3 p-4">
              <EmailField label={t('expenses.email.to')} onChange={(value) => setEmailForm((current) => ({ ...current, to: value }))} value={emailForm.to} />
              <div className="grid gap-3 sm:grid-cols-2">
                <EmailField label={t('expenses.email.cc')} onChange={(value) => setEmailForm((current) => ({ ...current, cc: value }))} value={emailForm.cc} />
                <EmailField label={t('expenses.email.bcc')} onChange={(value) => setEmailForm((current) => ({ ...current, bcc: value }))} value={emailForm.bcc} />
              </div>
              <EmailField label={t('expenses.email.subject')} onChange={(value) => setEmailForm((current) => ({ ...current, subject: value }))} value={emailForm.subject} />
              <label className="block">
                <span className="text-xs font-semibold uppercase text-slate-500">{t('expenses.email.message')}</span>
                <textarea className="mt-1 min-h-28 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15" onChange={(event) => setEmailForm((current) => ({ ...current, message: event.target.value }))} value={emailForm.message} />
              </label>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                {t('expenses.email.attachmentPreview')}: <span className="font-medium text-slate-900">{expenseReference(emailNote)}.pdf</span>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button className="h-9 rounded-md border border-slate-200 px-3 text-sm" onClick={() => setEmailNote(null)} type="button">{t('expenses.actions.cancel')}</button>
              <button className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white disabled:opacity-60" disabled={sendEmailMutation.isPending || !emailForm.to} onClick={() => sendEmailMutation.mutate(emailNote)} type="button">
                {sendEmailMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                {t('expenses.actions.sendEmail')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {historyNote ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{t('expenses.email.historyTitle')}</h2>
                <p className="text-xs text-slate-500">{expenseReference(historyNote)}</p>
              </div>
              <button className="rounded-md border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" onClick={() => setHistoryNote(null)} type="button"><X className="h-4 w-4" /></button>
            </div>
            <div className="max-h-[420px] overflow-y-auto p-4">
              {emailHistoryQuery.isLoading ? (
                <div className="flex items-center justify-center py-10 text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : emailHistoryQuery.data?.length ? (
                <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
                  {emailHistoryQuery.data.map((log) => <EmailHistoryRow key={log.id} log={log} t={t} />)}
                </div>
              ) : (
                <p className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">{t('expenses.email.noHistory')}</p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {hasPermission('expense_categories.manage') && hasPermission('expense_types.manage') ? (
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <button className="flex w-full items-center justify-between px-3 py-2 text-left rtl:text-right" onClick={() => setIsManageSectionOpen((value) => !value)} type="button">
            <span className="text-sm font-semibold text-slate-900">{t('expenses.manage.title')}</span>
            <SlidersHorizontal className="h-4 w-4 text-slate-500" />
          </button>
          {isManageSectionOpen ? (
          <div className="border-t border-slate-200 p-3">
            <div className="grid gap-3 xl:grid-cols-[1fr_1fr]">
              <div className="flex gap-2">
                <input className="h-10 min-w-0 flex-1 rounded-md border border-slate-200 px-3 text-sm" onChange={(event) => setCategoryName(event.target.value)} placeholder={t('expenses.manage.categoryName')} value={categoryName} />
                <button className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm" disabled={!categoryName || categoryMutation.isPending} onClick={() => categoryMutation.mutate()} type="button"><Plus className="h-4 w-4" />{t('expenses.actions.add')}</button>
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <select className="h-10 rounded-md border border-slate-200 px-3 text-sm" onChange={(event) => setTypeCategoryId(event.target.value)} value={typeCategoryId}>
                  <option value="">{t('expenses.fields.category')}</option>
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
                <input className="h-10 rounded-md border border-slate-200 px-3 text-sm" onChange={(event) => setTypeName(event.target.value)} placeholder={t('expenses.manage.typeName')} value={typeName} />
                <button className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm" disabled={!typeName || !typeCategoryId || typeMutation.isPending} onClick={() => typeMutation.mutate()} type="button"><Plus className="h-4 w-4" />{t('expenses.actions.add')}</button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {categories.map((category) => (
                <button className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-700 transition hover:bg-slate-50" key={category.id} onClick={() => toggleCategoryMutation.mutate(category)} type="button">
                  {category.name} ({category.active ? t('expenses.status.active') : t('expenses.status.inactive')})
                </button>
              ))}
              {types.map((type) => (
                <button className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700 transition hover:bg-slate-200" key={type.id} onClick={() => toggleTypeMutation.mutate(type)} type="button">
                  {type.name}{type.active ? '' : ` (${t('expenses.status.inactive')})`}
                </button>
              ))}
            </div>
          </div>
          ) : null}
        </div>
      ) : null}

      {isDrawerOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-950/40">
          <div className="absolute inset-y-0 right-0 flex w-full max-w-[680px] flex-col bg-white shadow-2xl sm:w-[78vw] lg:w-[680px] rtl:left-0 rtl:right-auto">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-3 py-2 sm:px-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{editingId ? t('expenses.form.editTitle') : t('expenses.form.createTitle')}</h2>
                <p className="text-xs text-slate-500">{t('expenses.form.description')}</p>
              </div>
              <button className="rounded-md border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50" onClick={closeDrawer} type="button"><X className="h-4 w-4" /></button>
            </div>
            <div className="shrink-0 border-b border-slate-200 px-3 py-1.5 sm:px-4">
              <Stepper current={drawerStep} t={t} />
            </div>
            <form className="min-h-0 flex-1 overflow-y-auto p-3" onSubmit={submitDraft}>
              <div className="grid gap-3 lg:grid-cols-[240px_minmax(0,1fr)]">
                <div className="space-y-3">
                  <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('expenses.fields.receipt')}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${receiptPreviewUrl ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-50 text-slate-600 ring-slate-200'}`}>
                        {receiptPreviewUrl ? t('expenses.verification.ready') : t('expenses.verification.pending')}
                      </span>
                    </div>
                  <label
                    className={`relative flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-3 py-3 text-center transition sm:min-h-[200px] ${isDraggingReceipt ? 'border-primary bg-primary/5' : 'border-slate-300 bg-slate-50 hover:border-primary hover:bg-primary/5'}`}
                    onDragEnter={() => setIsDraggingReceipt(true)}
                    onDragLeave={() => setIsDraggingReceipt(false)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={onDropReceipt}
                  >
                    {analyzeMutation.isPending ? (
                      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg bg-white/80">
                        <Loader2 className="mb-2 h-6 w-6 animate-spin text-primary" />
                        <span className="text-sm font-medium text-slate-700">{t('expenses.ai.processing')}</span>
                      </div>
                    ) : null}
                    {receiptPreviewUrl ? (
                      <div className="flex h-full w-full flex-col">
                        <div className="mb-2 flex items-center justify-between gap-2 text-xs text-slate-500">
                          <span className="truncate">{receiptPreviewName || t('expenses.fields.receipt')}</span>
                          <span>{receiptZoom}%</span>
                        </div>
                        <ReceiptPreview fileUrl={receiptPreviewUrl} onZoomIn={() => setReceiptZoom((value) => Math.min(value + 10, 160))} onZoomOut={() => setReceiptZoom((value) => Math.max(value - 10, 60))} title="" zoom={receiptZoom} />
                      </div>
                    ) : (
                      <>
                        <Upload className="mb-2 h-7 w-7 text-primary" />
                        <span className="text-sm font-semibold text-slate-800">{t('expenses.ai.upload')}</span>
                        <span className="mt-1 text-xs text-slate-500">{t('expenses.ai.dragHint')}</span>
                      </>
                    )}
                    <input className="sr-only" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={(event) => onReceiptSelected(event.target.files?.[0])} type="file" />
                  </label>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50" onClick={() => setReceiptZoom((value) => Math.max(value - 10, 60))} type="button"><ZoomOut className="h-3.5 w-3.5" />{t('expenses.actions.zoomOut')}</button>
                      <button className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50" onClick={() => setReceiptZoom((value) => Math.min(value + 10, 160))} type="button"><ZoomIn className="h-3.5 w-3.5" />{t('expenses.actions.zoomIn')}</button>
                      <label className="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-primary/30 px-2 text-xs font-medium text-primary transition hover:bg-primary/5">
                        <Upload className="h-3.5 w-3.5" />
                        {t('expenses.actions.replaceReceipt')}
                        <input className="sr-only" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={(event) => onReceiptSelected(event.target.files?.[0])} type="file" />
                      </label>
                      <button className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-rose-200 px-2 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-50" disabled={!receiptPreviewUrl || deleteAttachmentMutation.isPending} onClick={removeReceiptPreview} type="button"><Trash2 className="h-3.5 w-3.5" />{t('expenses.actions.removeReceipt')}</button>
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                      {t('expenses.ai.status')}
                    </div>
                    <div className="space-y-2 text-xs">
                      <InfoRow label={t('expenses.ai.confidence')} value={averageConfidence ? `${Math.round(averageConfidence * 100)}%` : '-'} />
                      <InfoRow label={t('expenses.ai.processingStatus')} value={analyzeMutation.isPending ? t('expenses.ai.processing') : t('expenses.verification.ready')} />
                      <InfoRow label={t('expenses.ai.extractedFields')} value={String(extractedFieldCount)} />
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="grid gap-3 xl:grid-cols-2">
                    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('expenses.drawer.sections.details')}</h3>
                      <div className="grid gap-3">
                      <FormSelect icon={Tag} label={t('expenses.fields.category')} required value={draft.categoryId} onChange={(value) => setDraft((current) => ({ ...current, categoryId: value, expenseTypeId: '' }))}>
                        {categories.filter((category) => category.active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                      </FormSelect>
                      <FormSelect icon={ReceiptText} label={t('expenses.fields.expenseType')} required value={draft.expenseTypeId} onChange={(value) => setDraft((current) => ({ ...current, expenseTypeId: value }))}>
                        {activeTypesForDraft.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                      </FormSelect>
                      <FormInput icon={CalendarDays} label={t('expenses.fields.date')} required type="date" value={draft.expenseDate} onChange={(value) => setDraft((current) => ({ ...current, expenseDate: value }))} />
                      <FormInput confidence={aiConfidence.category} icon={Store} label={t('expenses.fields.merchant')} value={draft.merchantName ?? ''} onChange={(value) => setDraft((current) => ({ ...current, merchantName: value }))} />
                      <FormInput icon={Hash} label={t('expenses.fields.receiptNumber')} value={draft.receiptNumber ?? ''} onChange={(value) => setDraft((current) => ({ ...current, receiptNumber: value }))} />
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('expenses.drawer.sections.amounts')}</h3>
                      <div className="grid gap-3">
                      <FormInput confidence={aiConfidence.vat} icon={CircleDollarSign} label={t('expenses.fields.amountHT')} type="number" value={String(draft.amountHT ?? 0)} onChange={(value) => setDraft((current) => ({ ...current, amountHT: Number(value) }))} />
                      <FormInput icon={Percent} label={t('expenses.fields.vatRate')} type="number" value={String(draft.vatRate)} onChange={(value) => setDraft((current) => ({ ...current, vatRate: Number(value) }))} />
                      <FormInput confidence={aiConfidence.vat} icon={CircleDollarSign} label={t('expenses.fields.vatAmount')} type="number" value={String(draft.vatAmount)} onChange={(value) => setDraft((current) => ({ ...current, vatAmount: Number(value) }))} />
                      <FormInput confidence={aiConfidence.amountTTC} icon={CircleDollarSign} label={t('expenses.fields.amountTTC')} required type="number" value={String(draft.amountTTC)} onChange={(value) => setDraft((current) => ({ ...current, amountTTC: Number(value) }))} />
                      <FormInput icon={CircleDollarSign} label={t('expenses.fields.currency')} value={draft.currency} onChange={(value) => setDraft((current) => ({ ...current, currency: value.toUpperCase() }))} />
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('expenses.fields.comment')}</h3>
                    <textarea className="min-h-16 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" onChange={(event) => setDraft((current) => ({ ...current, comment: event.target.value }))} placeholder={t('expenses.fields.comment')} value={draft.comment ?? ''} />
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('expenses.drawer.sections.verification')}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${missingFieldCount ? 'bg-amber-50 text-amber-700 ring-amber-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200'}`}>
                        {missingFieldCount ? t('expenses.verification.manualRequired') : t('expenses.verification.valid')}
                      </span>
                    </div>
                    <div className={`rounded-md border px-3 py-2 text-xs ${missingFieldCount || aiWarnings.length ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
                      <div className="flex items-center gap-2 font-medium">
                        {missingFieldCount || aiWarnings.length ? <AlertTriangle className="h-4 w-4" /> : <ClipboardCheck className="h-4 w-4" />}
                        {missingFieldCount ? t('expenses.verification.missingFields', { count: missingFieldCount }) : t('expenses.verification.noMissingFields')}
                      </div>
                    </div>
                    {(aiWarnings.length > 0 || Object.keys(aiConfidence).length > 0) ? (
                      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-900">
                        <div className="mb-2 flex items-center gap-2 font-medium"><Bot className="h-4 w-4" />{t('expenses.ai.review')}</div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {Object.entries(aiConfidence).map(([key, value]) => <ConfidenceMeter key={key} label={key} value={value} />)}
                        </div>
                        {aiWarnings.map((warning) => <div className="mt-2 flex gap-2 rounded-md bg-white/70 px-2 py-1.5 text-xs" key={warning}><AlertTriangle className="h-4 w-4 shrink-0" />{warning}</div>)}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </form>
            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-200 bg-white px-3 py-2 sm:px-4">
              <button className="h-8 rounded-md border border-slate-200 px-3 text-xs font-medium" onClick={closeDrawer} type="button">{t('expenses.actions.cancel')}</button>
              <button className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-primary px-3 text-xs font-medium text-primary transition hover:bg-primary/5 disabled:opacity-60" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate(false)} type="button">
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {t('expenses.actions.saveDraft')}
              </button>
              <button className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60" disabled={!receiptFile || analyzeMutation.isPending} onClick={analyzeAgain} type="button">
                {analyzeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                {t('expenses.actions.analyzeAgain')}
              </button>
              <button className="inline-flex h-8 items-center justify-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-white shadow-sm transition hover:bg-primary/90 disabled:opacity-60" disabled={saveMutation.isPending || submitMutation.isPending} onClick={submitForApproval} type="button">
                <Send className="h-4 w-4" />
                {editingId ? t('expenses.actions.submit') : t('expenses.actions.analyzeSubmit')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function FilterSelect({ children, label, onChange, value }: { children: React.ReactNode; label: string; onChange: (value: string) => void; value: string }) {
  return (
    <select className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm sm:w-[calc(50%-0.25rem)] lg:w-36" onChange={(event) => onChange(event.target.value)} value={value}>
      <option value="">{label}</option>
      {children}
    </select>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-md bg-slate-100 px-2 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
      {label}
      <button className="rounded p-0.5 text-slate-400 transition hover:bg-white hover:text-slate-700" onClick={onRemove} type="button">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function FormSelect({ children, icon: Icon, label, onChange, required, value }: { children: React.ReactNode; icon?: typeof Eye; label: string; onChange: (value: string) => void; required?: boolean; value: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase leading-none text-slate-500">
        {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        {label}
      </span>
      <select className="h-8 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" onChange={(event) => onChange(event.target.value)} required={required} value={value}>
        <option value="">{label}</option>
        {children}
      </select>
    </label>
  );
}

function FormInput({ confidence, icon: Icon, label, onChange, required, type = 'text', value }: { confidence?: number; icon?: typeof Eye; label: string; onChange: (value: string) => void; required?: boolean; type?: string; value: string }) {
  const lowConfidence = confidence !== undefined && confidence < 0.75;
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between gap-2 text-[11px] font-semibold uppercase leading-none text-slate-500">
        <span className="flex items-center gap-1.5">
          {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
          {label}
        </span>
        {confidence !== undefined ? <span className={lowConfidence ? 'text-amber-600' : 'text-emerald-600'}>{Math.round(confidence * 100)}%</span> : null}
      </span>
      <input className={`h-8 w-full rounded-md border bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 ${lowConfidence ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`} onChange={(event) => onChange(event.target.value)} required={required} step={type === 'number' ? '0.01' : undefined} type={type} value={value} />
    </label>
  );
}

function StatusBadge({ status, t }: { status: ExpenseNoteStatus; t: (key: string) => string }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${statusTone[status]}`}>{t(`expenses.status.workflow.${status}`)}</span>;
}

function ActionItem({ danger, icon: Icon, label, onClick }: { danger?: boolean; icon: typeof Eye; label: string; onClick: () => void }) {
  return (
    <button className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition hover:bg-slate-50 focus:bg-slate-50 focus:outline-none ${danger ? 'text-rose-600' : 'text-slate-700'}`} onClick={onClick} role="menuitem" type="button">
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function ConfidenceMeter({ label, value }: { label: string; value: number }) {
  const percentage = Math.round(value * 100);
  const tone = value < 0.75 ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div className="rounded-md bg-white/80 px-2 py-1.5">
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] font-medium">
        <span className="truncate text-slate-600">{label}</span>
        <span className={value < 0.75 ? 'text-amber-700' : 'text-emerald-700'}>{percentage}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

function ReceiptPreview({ alt = '', fileUrl, mimeType, onZoomIn, onZoomOut, title, zoom }: { alt?: string; fileUrl: string; mimeType?: string; onZoomIn: () => void; onZoomOut: () => void; title: string; zoom: number }) {
  const { t } = useTranslation();
  const previewHeight = title ? 'h-80' : 'h-36 sm:h-40';

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 shadow-sm">
      {title ? (
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2">
          <span className="text-sm font-semibold text-slate-900">{title}</span>
          <div className="flex items-center gap-1">
            <button className="rounded-md border border-slate-200 p-1.5 text-slate-600" onClick={onZoomOut} type="button"><ZoomOut className="h-3.5 w-3.5" /></button>
            <button className="rounded-md border border-slate-200 p-1.5 text-slate-600" onClick={onZoomIn} type="button"><ZoomIn className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      ) : null}
      <div className={`flex ${previewHeight} items-center justify-center overflow-auto bg-slate-50/80 p-3`}>
        {!fileUrl ? (
          <div className="text-center text-sm text-slate-500"><ReceiptText className="mx-auto mb-2 h-8 w-8 text-slate-300" />{t('expenses.empty.preview')}</div>
        ) : mimeType === 'application/pdf' || fileUrl.toLowerCase().endsWith('.pdf') ? (
          <iframe className="h-full w-full rounded-md bg-white" src={fileUrl} title={alt} />
        ) : (
          <img alt={alt} className="max-h-full max-w-full rounded-md object-contain transition" src={fileUrl} style={{ transform: `scale(${zoom / 100})` }} />
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
      <span className="text-xs font-medium uppercase text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900 rtl:text-left">{value}</span>
    </div>
  );
}

function Timeline({ note, t }: { note: ExpenseNote; t: (key: string, options?: { defaultValue?: string }) => string }) {
  const logs = note.auditLogs ?? [];

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-3 py-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('expenses.review.audit')}</h3>
      </div>
      <div className="px-3 py-3">
        {logs.length ? (
          <ol className="relative before:absolute before:bottom-4 before:left-[11px] before:top-4 before:w-px before:bg-slate-200 rtl:before:left-auto rtl:before:right-[11px]">
            {logs.map((log, index) => {
              const tone = auditTone[log.action] ?? 'bg-slate-500 ring-slate-100';
              const createdAt = new Date(log.createdAt);

              return (
                <li className={`relative grid min-w-0 grid-cols-[24px_minmax(0,1fr)] gap-3 pb-4 last:pb-0 rtl:grid-cols-[minmax(0,1fr)_24px] ${index < logs.length - 1 ? 'border-b border-slate-100' : ''}`} key={log.id}>
                  <div className="relative flex justify-center pt-1 rtl:order-2">
                    <span className={`relative z-10 h-3.5 w-3.5 rounded-full border-2 border-white shadow-sm ring-4 ${tone}`} />
                  </div>
                  <div className="min-w-0 py-0.5">
                    <p className="text-sm font-semibold leading-5 text-slate-900">{t(`expenses.audit.${log.action}`, { defaultValue: log.action })}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                      <span className="font-medium text-slate-600">{log.actor?.name ?? '-'}</span>
                      <span className="text-slate-300">-</span>
                      <time dateTime={createdAt.toISOString()}>{createdAt.toLocaleString()}</time>
                    </div>
                    {log.reason ? <p className="mt-2 rounded-md border border-slate-100 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">{log.reason}</p> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-sm text-slate-500">{t('expenses.review.noAudit')}</p>
        )}
      </div>
    </div>
  );
}

function Stepper({ current, t }: { current: DrawerStep; t: (key: string) => string }) {
  const steps: DrawerStep[] = ['receipt', 'analysis', 'review', 'submit'];
  const currentIndex = steps.indexOf(current);
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      {steps.map((step, index) => (
        <div className={`flex min-w-max items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${index <= currentIndex ? 'bg-primary text-white' : 'bg-slate-100 text-slate-500'}`} key={step}>
          <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${index <= currentIndex ? 'bg-white/20 text-white' : 'bg-white text-slate-500'}`}>{index + 1}</span>
          <span>{t(`expenses.drawer.steps.${step}`)}</span>
        </div>
      ))}
    </div>
  );
}

function EmailField({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-slate-500">{label}</span>
      <input className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15" onChange={(event) => onChange(event.target.value)} value={value} />
    </label>
  );
}

function ViewModeButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: typeof FileText; label: string; onClick: () => void }) {
  return (
    <button
      aria-pressed={active}
      className={`inline-flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium transition ${active ? 'bg-primary text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden xl:inline">{label}</span>
    </button>
  );
}

function KanbanView({ notes, onOpen, t }: { notes: ExpenseNote[]; onOpen: (note: ExpenseNote) => void; t: (key: string, options?: { count?: number }) => string }) {
  return (
    <div className="grid gap-3 bg-slate-50/70 p-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      {kanbanStatuses.map((status) => {
        const columnNotes = notes.filter((note) => note.status === status);
        return (
          <section className="min-h-[220px] rounded-lg border border-slate-200 bg-white shadow-sm" key={status}>
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <StatusBadge status={status} t={t} />
              <span className="text-xs font-semibold text-slate-500">{columnNotes.length}</span>
            </div>
            <div className="space-y-2 p-2">
              {columnNotes.length ? columnNotes.map((note) => (
                <button className="w-full rounded-md border border-slate-200 bg-white p-2 text-left shadow-sm transition hover:border-primary/30 hover:bg-primary/5 rtl:text-right" key={note.id} onClick={() => onOpen(note)} type="button">
                  <p className="truncate text-sm font-semibold text-slate-900">{note.merchantName || note.documentNumber || '-'}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{note.category?.name} / {note.expenseType?.name}</p>
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                    <span className="text-slate-500">{new Date(note.expenseDate).toLocaleDateString()}</span>
                    <span className="font-bold text-slate-900">{formatCurrency(Number(note.amountTTC), note.currency)}</span>
                  </div>
                </button>
              )) : <p className="px-2 py-6 text-center text-xs text-slate-400">{t('expenses.empty.noColumnItems')}</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CalendarView({ notes, onOpen, t }: { notes: ExpenseNote[]; onOpen: (note: ExpenseNote) => void; t: (key: string) => string }) {
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const leadingDays = firstDay.getDay();
  const cells = Array.from({ length: leadingDays + daysInMonth }, (_, index) => index < leadingDays ? null : index - leadingDays + 1);

  return (
    <div className="bg-slate-50/70 p-3">
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
          <h2 className="text-sm font-bold text-slate-900">{t('expenses.views.calendar')} - {today.toLocaleString(undefined, { month: 'long', year: 'numeric' })}</h2>
          <span className="text-xs text-slate-500">{notes.length}</span>
        </div>
        <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50 text-center text-[11px] font-semibold uppercase text-slate-500">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <div className="px-2 py-2" key={day}>{day}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day, index) => {
            const dayNotes = day ? notes.filter((note) => {
              const date = new Date(note.expenseDate);
              return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === day;
            }) : [];
            return (
              <div className="min-h-[112px] border-b border-r border-slate-100 p-1.5 rtl:border-l rtl:border-r-0" key={`${day ?? 'empty'}-${index}`}>
                {day ? <div className="mb-1 text-xs font-semibold text-slate-500">{day}</div> : null}
                <div className="space-y-1">
                  {dayNotes.slice(0, 3).map((note) => (
                    <button className="block w-full truncate rounded bg-primary/5 px-1.5 py-1 text-left text-[11px] font-medium text-primary hover:bg-primary/10 rtl:text-right" key={note.id} onClick={() => onOpen(note)} title={note.merchantName ?? ''} type="button">
                      {formatCurrency(Number(note.amountTTC), note.currency)} - {note.merchantName || '-'}
                    </button>
                  ))}
                  {dayNotes.length > 3 ? <span className="text-[11px] text-slate-400">+{dayNotes.length - 3}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AnalyticsView({ analytics, currency, isLoading, t }: { analytics?: ExpenseAnalytics; currency: string; isLoading: boolean; t: (key: string) => string }) {
  if (isLoading) {
    return <div className="grid gap-3 bg-slate-50/70 p-3 md:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <div className="h-28 animate-pulse rounded-lg bg-slate-100" key={index} />)}</div>;
  }
  if (!analytics) {
    return <div className="p-8 text-center text-sm text-slate-500">{t('expenses.empty.noAnalytics')}</div>;
  }

  return (
    <div className="space-y-3 bg-slate-50/70 p-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <AnalyticsMetric label={t('expenses.analytics.currentMonth')} value={formatCurrency(analytics.totals.currentMonth, currency)} />
        <AnalyticsMetric label={t('expenses.analytics.currentQuarter')} value={formatCurrency(analytics.totals.currentQuarter, currency)} />
        <AnalyticsMetric label={t('expenses.analytics.currentYear')} value={formatCurrency(analytics.totals.currentYear, currency)} />
        <AnalyticsMetric label={t('expenses.analytics.averageExpense')} value={formatCurrency(analytics.totals.averageExpense, currency)} />
        <AnalyticsMetric label={t('expenses.analytics.vatTotals')} value={formatCurrency(analytics.totals.vatAmount, currency)} />
        <AnalyticsMetric label={t('expenses.analytics.averageApprovalTime')} value={`${analytics.totals.averageApprovalHours.toFixed(1)} h`} />
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <AnalyticsPanel items={analytics.byMonth} title={t('expenses.analytics.byMonth')} />
        <AnalyticsPanel items={analytics.byCategory} title={t('expenses.analytics.byCategory')} />
        <AnalyticsPanel items={analytics.byEmployee} title={t('expenses.analytics.byEmployee')} />
        <AnalyticsPanel items={analytics.byStatus} title={t('expenses.analytics.byStatus')} />
        <AnalyticsPanel items={analytics.byCurrency} title={t('expenses.analytics.byCurrency')} />
        <AnalyticsPanel items={analytics.topMerchants} title={t('expenses.analytics.topMerchants')} />
      </div>
    </div>
  );
}

function AnalyticsMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
    </div>
  );
}

function AnalyticsPanel({ items, title }: { items: ExpenseAnalyticsGroup[]; title: string }) {
  const max = Math.max(...items.map((item) => item.amountTTC), 1);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      <div className="mt-3 space-y-2">
        {items.length ? items.slice(0, 8).map((item) => (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm" key={item.key}>
            <div className="min-w-0">
              <div className="flex justify-between gap-2 text-xs">
                <span className="truncate font-medium text-slate-700">{item.key}</span>
                <span className="text-slate-500">{item.count}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, (item.amountTTC / max) * 100)}%` }} />
              </div>
            </div>
            <span className="text-xs font-semibold text-slate-900">{Math.round(item.amountTTC).toLocaleString()}</span>
          </div>
        )) : <p className="text-sm text-slate-500">-</p>}
      </div>
    </div>
  );
}

function EmailHistoryRow({ log, t }: { log: ExpenseEmailLog; t: (key: string, options?: { defaultValue?: string }) => string }) {
  return (
    <div className="grid gap-2 px-3 py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-900">{log.recipientEmail}</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${log.status === 'SENT' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-rose-200'}`}>
            {log.status}
          </span>
        </div>
        <p className="mt-1 truncate text-xs text-slate-500" title={log.subject}>{log.subject}</p>
        {log.errorMessage ? <p className="mt-1 text-xs text-rose-600">{log.errorMessage}</p> : null}
      </div>
      <div className="text-xs text-slate-500 sm:text-right rtl:sm:text-left">
        <p>{log.sentBy?.name ?? '-'}</p>
        <p>{new Date(log.createdAt).toLocaleString()}</p>
        <p>{t('expenses.email.attachment')}: {log.attachmentName}</p>
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 10 }).map((_, index) => (
        <td className="px-3 py-3" key={index}>
          <div className="h-4 animate-pulse rounded bg-slate-100" />
        </td>
      ))}
    </tr>
  );
}

function splitEmailList(value: string) {
  return value.split(',').map((email) => email.trim()).filter(Boolean);
}
