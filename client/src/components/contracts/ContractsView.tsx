import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, BriefcaseBusiness, Calculator, Clock, Download, Eye, FileSignature, FileText, Mail, MoreHorizontal, Pencil, Plus, Search, Send, ShieldCheck, Stamp, Trash2, UserRound, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/hooks/useConfirm';
import { useToast } from '@/hooks/useToast';
import {
  createContract,
  approveContractMilestone,
  approveContractTimeEntry,
  cancelContract,
  createContractBillingScheduleItem,
  createContractMilestone,
  createContractTimeEntry,
  deleteContract,
  downloadContractPdf,
  getContractById,
  getContracts,
  getContractTemplates,
  getCustomers,
  generateContractInvoice,
  previewContractPdf,
  rejectContractTimeEntry,
  revokeContractSignature,
  sendContract,
  sendContractEmail,
  signContractForCompany,
  submitContractTimeEntry,
  terminateContract,
  updateContractTimeEntry,
  updateContract,
} from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import type { AiAssistantContext } from '@/lib/api';
import type { Contract, ContractBillingFrequency, ContractPricingType, ContractProrationPolicy, ContractRenewalType, ContractStatus } from '@/types';

type Props = {
  hasPermission: (permission: string) => boolean;
  getApiErrorMessage: (error: unknown, fallback: string) => string;
  onAiContextChange?: (context?: AiAssistantContext) => void;
  onOpenInvoice?: (invoiceId: string) => void;
};

type ContractBillingInvoiceInput = {
  periodStart?: string | null;
  periodEnd?: string | null;
  milestoneId?: string;
  scheduleItemId?: string;
};

interface ActionMenuPosition {
  left: number;
  top: number;
}

const statusClasses: Record<ContractStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  SENT: 'bg-blue-100 text-blue-700',
  VIEWED: 'bg-violet-100 text-violet-700',
  SIGNED: 'bg-emerald-100 text-emerald-700',
  ACTIVE: 'bg-green-100 text-green-700',
  EXPIRED: 'bg-orange-100 text-orange-700',
  TERMINATED: 'bg-rose-100 text-rose-700',
  CANCELLED: 'bg-slate-200 text-slate-700',
};

const timeEntryStatusClasses = {
  DRAFT: 'bg-slate-100 text-slate-700',
  SUBMITTED: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-rose-100 text-rose-700',
  INVOICED: 'bg-blue-100 text-blue-700',
  LOCKED: 'bg-slate-200 text-slate-700',
} as const;

const contractBusinessStatuses: ContractStatus[] = ['DRAFT', 'SENT', 'VIEWED', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'CANCELLED'];
const contractSummaryStatuses: ContractStatus[] = ['DRAFT', 'SENT', 'ACTIVE', 'EXPIRED'];
const pricingTypes: ContractPricingType[] = ['FIXED', 'HOURLY', 'DAILY', 'MONTHLY', 'MONTHLY_SUBSCRIPTION', 'ANNUAL_SUBSCRIPTION', 'MILESTONE', 'CUSTOM'];
const billingFrequencies: ContractBillingFrequency[] = ['ONE_TIME', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL', 'CUSTOM'];
const prorationPolicies: ContractProrationPolicy[] = ['NONE', 'ACTUAL_DAYS', 'FIXED_30_DAYS'];

const initialForm = {
  clientId: '',
  templateId: '',
  title: '',
  contractType: 'GENERAL',
  language: 'fr' as 'fr' | 'en' | 'ar',
  startDate: '',
  endDate: '',
  renewalType: 'NONE' as ContractRenewalType,
  renewalNoticeDays: '',
  amount: '',
  currency: 'MAD',
  pricingType: 'FIXED' as ContractPricingType,
  unitRate: '',
  estimatedQuantity: '',
  fixedAmount: '',
  billingFrequency: 'ONE_TIME' as ContractBillingFrequency,
  billingDay: '',
  billingStartDate: '',
  billingEndDate: '',
  minimumBillableUnits: '',
  includedUnits: '',
  overtimeRate: '',
  taxRate: '20',
  paymentTermsDays: '30',
  autoInvoiceEnabled: false,
  nextInvoiceDate: '',
  prorationPolicy: 'NONE' as ContractProrationPolicy,
  billingDescription: '',
  summary: '',
  terms: '',
  content: '',
};

export function ContractsView({ hasPermission, getApiErrorMessage, onAiContextChange, onOpenInvoice }: Props) {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const actionButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ContractStatus | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const [openForm, setOpenForm] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [viewId, setViewId] = useState('');
  const [openMenuId, setOpenMenuId] = useState('');
  const [actionMenuPosition, setActionMenuPosition] = useState<ActionMenuPosition | null>(null);
  const [signatureRevokeContract, setSignatureRevokeContract] = useState<Contract | null>(null);
  const [revocationReason, setRevocationReason] = useState('');
  const [revocationNote, setRevocationNote] = useState('');
  const [revocationConfirmed, setRevocationConfirmed] = useState(false);
  const [form, setForm] = useState(initialForm);
  const language = (i18n.resolvedLanguage || i18n.language || 'fr').startsWith('ar')
    ? 'ar'
    : (i18n.resolvedLanguage || i18n.language || 'fr').startsWith('en')
      ? 'en'
      : 'fr';

  const contractsQuery = useQuery({
    queryKey: ['contracts', search, status, page],
    queryFn: () => getContracts({ page, limit: 20, search: search || undefined, status: status === 'ALL' ? undefined : status }),
  });

  const customersQuery = useQuery({
    queryKey: ['contracts', 'customers'],
    queryFn: () => getCustomers({ page: 1, limit: 200, sortBy: 'createdAt', sortOrder: 'desc' }),
    enabled: openForm,
  });

  const templatesQuery = useQuery({
    queryKey: ['contract-templates'],
    queryFn: getContractTemplates,
    enabled: openForm,
  });

  const detailsQuery = useQuery({
    queryKey: ['contracts', 'detail', viewId],
    queryFn: () => getContractById(viewId),
    enabled: Boolean(viewId),
  });

  const contracts = useMemo(() => contractsQuery.data?.data ?? [], [contractsQuery.data?.data]);
  const meta = contractsQuery.data?.meta;
  const selectedTemplate = templatesQuery.data?.find((template) => template.id === form.templateId);
  const activeActionContract = useMemo(() => contracts.find((contract) => contract.id === openMenuId), [contracts, openMenuId]);
  const selectedListContract = useMemo(() => contracts.find((contract) => contract.id === viewId), [contracts, viewId]);
  const contextContract = detailsQuery.data ?? selectedListContract;

  useEffect(() => {
    if (!onAiContextChange) return;
    if (viewId && contextContract) {
      onAiContextChange({
        entityType: 'contract',
        entityId: contextContract.id,
        readableReference: `${contextContract.contractNumber} - ${contextContract.client?.company ?? contextContract.client?.name ?? contextContract.title}`,
      });
    } else {
      onAiContextChange(undefined);
    }
    return () => onAiContextChange(undefined);
  }, [contextContract, onAiContextChange, viewId]);

  const updateActionMenuPosition = useCallback((contractId = openMenuId) => {
    if (!contractId) {
      return;
    }

    const button = actionButtonRefs.current.get(contractId);
    if (!button) {
      return;
    }

    const rect = button.getBoundingClientRect();
    const menuWidth = 224;
    const menuHeight = actionMenuRef.current?.offsetHeight ?? 272;
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
  }, [openMenuId]);

  useLayoutEffect(() => {
    if (openMenuId) {
      updateActionMenuPosition(openMenuId);
    } else {
      setActionMenuPosition(null);
    }
  }, [openMenuId, updateActionMenuPosition]);

  useEffect(() => {
    if (!openMenuId) {
      return;
    }

    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      const button = actionButtonRefs.current.get(openMenuId);
      if (actionMenuRef.current?.contains(target) || button?.contains(target)) {
        return;
      }

      setOpenMenuId('');
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenMenuId('');
      }
    };
    const reposition = () => updateActionMenuPosition(openMenuId);

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
  }, [openMenuId, updateActionMenuPosition]);

  useEffect(() => {
    if (!openMenuId || !actionMenuPosition) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      actionMenuRef.current?.querySelector('button')?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [openMenuId, actionMenuPosition]);

  const statusCounts = contractsQuery.data?.stats ?? {};

  const syncContracts = useCallback((contract?: Contract) => {
    if (contract) {
      queryClient.setQueryData(['contracts', 'detail', contract.id], contract);
    }
    queryClient.invalidateQueries({ queryKey: ['contracts'] });
  }, [queryClient]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        clientId: form.clientId,
        templateId: form.templateId || null,
        title: form.title,
        contractType: form.contractType,
        language: form.language,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        renewalType: form.renewalType,
        renewalNoticeDays: form.renewalNoticeDays ? Number(form.renewalNoticeDays) : null,
        amount: form.amount ? Number(form.amount) : null,
        currency: form.currency,
        pricingType: form.pricingType,
        unitRate: form.unitRate ? Number(form.unitRate) : null,
        estimatedQuantity: form.estimatedQuantity ? Number(form.estimatedQuantity) : null,
        fixedAmount: form.fixedAmount ? Number(form.fixedAmount) : (form.amount ? Number(form.amount) : null),
        billingFrequency: form.billingFrequency,
        billingDay: form.billingDay ? Number(form.billingDay) : null,
        billingStartDate: form.billingStartDate || null,
        billingEndDate: form.billingEndDate || null,
        minimumBillableUnits: form.minimumBillableUnits ? Number(form.minimumBillableUnits) : null,
        includedUnits: form.includedUnits ? Number(form.includedUnits) : null,
        overtimeRate: form.overtimeRate ? Number(form.overtimeRate) : null,
        taxRate: Number(form.taxRate || 0),
        paymentTermsDays: Number(form.paymentTermsDays || 30),
        autoInvoiceEnabled: form.autoInvoiceEnabled,
        nextInvoiceDate: form.nextInvoiceDate || null,
        prorationPolicy: form.prorationPolicy,
        billingDescription: form.billingDescription || null,
        summary: form.summary || null,
        terms: form.terms || null,
        content: form.content || form.terms || selectedTemplate?.content,
      };
      return editingId ? updateContract(editingId, payload) : createContract(payload);
    },
    onSuccess: (contract) => {
      toast.success(t(editingId ? 'contracts.messages.updated' : 'contracts.messages.created', { number: contract.contractNumber }));
      setOpenForm(false);
      setEditingId('');
      setForm(initialForm);
      syncContracts(contract);
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('contracts.messages.saveFailed'))),
  });

  const sendMutation = useMutation({
    mutationFn: sendContract,
    onSuccess: () => {
      toast.success(t('contracts.messages.sent'));
      syncContracts();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('contracts.messages.actionFailed'))),
  });

  const signMutation = useMutation({
    mutationFn: signContractForCompany,
    onSuccess: (contract) => {
      toast.success(t('contracts.messages.signed'));
      syncContracts(contract);
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('contracts.messages.actionFailed'))),
  });

  const cancelMutation = useMutation({
    mutationFn: cancelContract,
    onSuccess: (contract) => {
      toast.success(t('contracts.messages.cancelled'));
      syncContracts(contract);
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('contracts.messages.actionFailed'))),
  });

  const terminateMutation = useMutation({
    mutationFn: terminateContract,
    onSuccess: (contract) => {
      toast.success(t('contracts.messages.terminated'));
      syncContracts(contract);
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('contracts.messages.actionFailed'))),
  });

  const emailMutation = useMutation({
    mutationFn: (contract: Contract) => sendContractEmail(contract.id, {
      to: contract.client.email,
      pdfLanguage: language,
      subject: t('contracts.email.subject', { number: contract.contractNumber }),
    }),
    onSuccess: () => {
      toast.success(t('contracts.messages.emailSent'));
      syncContracts();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('contracts.messages.emailFailed'))),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteContract,
    onSuccess: () => {
      toast.success(t('contracts.messages.deleted'));
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('contracts.messages.deleteFailed'))),
  });

  const revokeSignatureMutation = useMutation({
    mutationFn: () => {
      if (!signatureRevokeContract) throw new Error('Contract is required');
      return revokeContractSignature(signatureRevokeContract.id, {
        reason: revocationReason,
        internalNote: revocationNote || null,
        confirmed: true,
      });
    },
    onSuccess: (contract) => {
      toast.success(t('contracts.messages.signatureRevoked'));
      setSignatureRevokeContract(null);
      setRevocationReason('');
      setRevocationNote('');
      setRevocationConfirmed(false);
      syncContracts(contract);
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('contracts.messages.signatureRevokeFailed'))),
  });

  const generateInvoiceMutation = useMutation({
    mutationFn: ({ contract, input = {} }: { contract: Contract; input?: ContractBillingInvoiceInput }) => generateContractInvoice(contract.id, input),
    onSuccess: (invoice, variables) => {
      toast.success(t('contracts.messages.invoiceGenerated', { number: invoice.invoiceNumber }));
      syncContracts(variables.contract);
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('contracts.messages.invoiceGenerationFailed'))),
  });

  const submitForm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    saveMutation.mutate();
  };

  const openCreateForm = () => {
    setEditingId('');
    setForm(initialForm);
    setOpenForm(true);
  };

  const openEditForm = (contract: Contract) => {
    setEditingId(contract.id);
    setForm({
      clientId: contract.clientId,
      templateId: '',
      title: contract.title,
      contractType: contract.contractType,
      language: contract.language,
      startDate: contract.startDate?.slice(0, 10) ?? '',
      endDate: contract.endDate?.slice(0, 10) ?? '',
      renewalType: contract.renewalType,
      renewalNoticeDays: contract.renewalNoticeDays?.toString() ?? '',
      amount: contract.amount?.toString() ?? '',
      currency: contract.currency,
      pricingType: contract.pricingType,
      unitRate: contract.unitRate?.toString() ?? '',
      estimatedQuantity: contract.estimatedQuantity?.toString() ?? '',
      fixedAmount: contract.fixedAmount?.toString() ?? contract.amount?.toString() ?? '',
      billingFrequency: contract.billingFrequency,
      billingDay: contract.billingDay?.toString() ?? '',
      billingStartDate: contract.billingStartDate?.slice(0, 10) ?? '',
      billingEndDate: contract.billingEndDate?.slice(0, 10) ?? '',
      minimumBillableUnits: contract.minimumBillableUnits?.toString() ?? '',
      includedUnits: contract.includedUnits?.toString() ?? '',
      overtimeRate: contract.overtimeRate?.toString() ?? '',
      taxRate: contract.taxRate?.toString() ?? '20',
      paymentTermsDays: contract.paymentTermsDays?.toString() ?? '30',
      autoInvoiceEnabled: contract.autoInvoiceEnabled,
      nextInvoiceDate: contract.nextInvoiceDate?.slice(0, 10) ?? '',
      prorationPolicy: contract.prorationPolicy,
      billingDescription: contract.billingDescription ?? '',
      summary: contract.summary ?? '',
      terms: contract.terms ?? '',
      content: contract.currentVersion?.content ?? '',
    });
    setOpenForm(true);
  };

  const confirmDelete = async (contract: Contract) => {
    const accepted = await confirm({
      title: t('contracts.confirm.deleteTitle'),
      description: t('contracts.confirm.deleteDescription', { number: contract.contractNumber }),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
      variant: 'danger',
    });
    if (accepted) deleteMutation.mutate(contract.id);
  };

  const confirmCancel = async (contract: Contract) => {
    const accepted = await confirm({
      title: t('contracts.confirm.cancelTitle'),
      description: t('contracts.confirm.cancelDescription', { number: contract.contractNumber }),
      confirmText: t('contracts.actions.cancel'),
      cancelText: t('common.cancel'),
      variant: 'warning',
    });
    if (accepted) cancelMutation.mutate(contract.id);
  };

  const confirmTerminate = async (contract: Contract) => {
    const accepted = await confirm({
      title: t('contracts.confirm.terminateTitle'),
      description: t('contracts.confirm.terminateDescription', { number: contract.contractNumber }),
      confirmText: t('contracts.actions.terminate'),
      cancelText: t('common.cancel'),
      variant: 'danger',
    });
    if (accepted) terminateMutation.mutate(contract.id);
  };

  const applyTemplate = (templateId: string) => {
    const template = templatesQuery.data?.find((item) => item.id === templateId);
    setForm((current) => ({
      ...current,
      templateId,
      content: template?.content ?? current.content,
      title: current.title || template?.[language === 'ar' ? 'nameAr' : language === 'en' ? 'nameEn' : 'nameFr'] || '',
    }));
  };

  const showFixedAmount = form.pricingType === 'FIXED';
  const showUnitRate = ['HOURLY', 'DAILY', 'MONTHLY', 'MONTHLY_SUBSCRIPTION', 'ANNUAL_SUBSCRIPTION'].includes(form.pricingType);
  const showUsageFields = ['HOURLY', 'DAILY'].includes(form.pricingType);
  const showBillingDates = ['MONTHLY', 'MONTHLY_SUBSCRIPTION', 'ANNUAL_SUBSCRIPTION'].includes(form.pricingType);
  const showBillingDescription = form.pricingType === 'CUSTOM';

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">{t('contracts.module')}</p>
            <h2 className="text-xl font-bold text-slate-950">{t('contracts.title')}</h2>
            <p className="text-sm text-slate-500">{t('contracts.count', { count: meta?.total ?? contracts.length })}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <Search className="pointer-events-none absolute top-2.5 h-4 w-4 text-slate-400 ltr:left-3 rtl:right-3" />
              <input
                className="h-9 w-64 rounded-md border border-slate-200 bg-white px-9 text-sm outline-none ring-primary/20 transition focus:ring-4"
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder={t('contracts.search')}
                type="search"
                value={search}
              />
            </label>
            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
              onChange={(event) => {
                setStatus(event.target.value as ContractStatus | 'ALL');
                setPage(1);
              }}
              value={status}
            >
              <option value="ALL">{t('contracts.labels.all')}</option>
              {contractBusinessStatuses.map((item) => (
                <option key={item} value={item}>{t(`contracts.status.${item}`)}</option>
              ))}
            </select>
            {hasPermission('contracts.create') ? (
              <button className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white transition hover:bg-primary/90" onClick={openCreateForm} type="button">
                <Plus className="h-4 w-4" />
                {t('contracts.new')}
              </button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-px border-b border-slate-200 bg-slate-200 md:grid-cols-4">
          {contractSummaryStatuses.map((item) => (
            <button className="bg-white p-3 text-left transition hover:bg-slate-50 rtl:text-right" key={item} onClick={() => setStatus(item)} type="button">
              <p className="text-lg font-bold text-slate-950">{statusCounts[item] ?? 0}</p>
              <p className="text-xs font-medium text-slate-500">{t(`contracts.status.${item}`)}</p>
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold rtl:text-right">{t('contracts.fields.number')}</th>
                <th className="px-4 py-3 text-left font-semibold rtl:text-right">{t('contracts.fields.client')}</th>
                <th className="px-4 py-3 text-left font-semibold rtl:text-right">{t('contracts.fields.period')}</th>
                <th className="px-4 py-3 text-left font-semibold rtl:text-right">{t('contracts.pricing.title')}</th>
                <th className="px-4 py-3 text-center font-semibold">{t('contracts.fields.timeEntries')}</th>
                <th className="px-4 py-3 text-right font-semibold">{t('contracts.fields.amount')}</th>
                <th className="px-4 py-3 text-left font-semibold rtl:text-right">{t('contracts.labels.contractStatus')}</th>
                <th className="px-4 py-3 text-left font-semibold rtl:text-right">{t('contracts.signature.title')}</th>
                <th className="px-4 py-3 text-right font-semibold">{t('contracts.labels.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {contracts.map((contract) => (
                <tr className="transition hover:bg-slate-50" key={contract.id}>
                  <td className="px-4 py-3">
                    <button className="font-semibold text-primary hover:underline" onClick={() => setViewId(contract.id)} type="button">{contract.contractNumber}</button>
                    <p className="max-w-[220px] truncate text-xs text-slate-500" title={contract.title}>{contract.title}</p>
                    <button className="mt-1 text-xs font-medium text-primary hover:underline" onClick={() => setViewId(contract.id)} type="button">
                      {t('contracts.details')}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{contract.client.company ?? contract.client.name}</p>
                    <p className="text-xs text-slate-500">{contract.client.email}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(contract.startDate)} - {formatDate(contract.endDate)}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{t(`contracts.pricing.types.${contract.pricingType}`)}</p>
                    <p className="text-xs text-slate-500">{formatContractPricing(contract, t)}</p>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      className="inline-flex min-w-10 items-center justify-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-primary/10 hover:text-primary"
                      onClick={() => setViewId(contract.id)}
                      title={t('contracts.billing.timeEntries')}
                      type="button"
                    >
                      {contract._count?.timeEntries ?? contract.timeEntries?.length ?? 0}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">{formatContractAmount(contract)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${statusClasses[contract.status]}`}>{t(`contracts.status.${contract.status}`)}</span>
                  </td>
                  <td className="px-4 py-3"><SignatureBadge status={contract.currentVersion?.signatureStatus ?? 'NOT_STARTED'} translate={t} /></td>
                  <td className="px-4 py-3 text-right">
                    <button
                      aria-expanded={openMenuId === contract.id}
                      aria-haspopup="menu"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                      onClick={() => {
                        setOpenMenuId((current) => {
                          if (current === contract.id) {
                            return '';
                          }

                          updateActionMenuPosition(contract.id);
                          return contract.id;
                        });
                      }}
                      ref={(element) => {
                        if (element) {
                          actionButtonRefs.current.set(contract.id, element);
                        } else {
                          actionButtonRefs.current.delete(contract.id);
                        }
                      }}
                      type="button"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {!contracts.length ? (
                <tr>
                  <td className="px-4 py-12 text-center text-sm text-slate-500" colSpan={8}>{t('contracts.empty')}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
          <span>{t('contracts.pagination', { page, total: meta?.totalPages ?? 1 })}</span>
          <div className="flex gap-2">
            <button className="h-8 rounded-md border border-slate-200 px-3 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button">{t('contracts.labels.previous')}</button>
            <button className="h-8 rounded-md border border-slate-200 px-3 disabled:opacity-40" disabled={page >= (meta?.totalPages ?? 1)} onClick={() => setPage((value) => value + 1)} type="button">{t('contracts.labels.next')}</button>
          </div>
        </div>
      </div>

      {activeActionContract && actionMenuPosition ? createPortal(
        <div
          aria-orientation="vertical"
          className="fixed z-[60] w-56 overflow-hidden rounded-lg border border-slate-200 bg-white p-1 text-left shadow-lg rtl:text-right"
          ref={actionMenuRef}
          role="menu"
          style={{ left: actionMenuPosition.left, top: actionMenuPosition.top }}
        >
          <Action onClick={() => { setViewId(activeActionContract.id); setOpenMenuId(''); }} icon={<Eye className="h-4 w-4" />} label={t('contracts.labels.view')} />
          {activeActionContract.status === 'DRAFT' && hasPermission('contracts.update') ? <Action onClick={() => { openEditForm(activeActionContract); setOpenMenuId(''); }} icon={<Pencil className="h-4 w-4" />} label={t('common.edit')} /> : null}
          {activeActionContract.status === 'DRAFT' && hasPermission('contracts.send') ? <Action onClick={() => { sendMutation.mutate(activeActionContract.id); setOpenMenuId(''); }} icon={<Send className="h-4 w-4" />} label={t('contracts.actions.send')} /> : null}
          {['DRAFT', 'SENT', 'VIEWED'].includes(activeActionContract.status) && ['NOT_STARTED', 'COMPANY_PENDING'].includes(activeActionContract.currentVersion?.signatureStatus ?? 'NOT_STARTED') && hasPermission('contracts.sign.company') ? <Action onClick={() => { signMutation.mutate(activeActionContract.id); setOpenMenuId(''); }} icon={<FileSignature className="h-4 w-4" />} label={t('contracts.actions.signCompany')} /> : null}
          {hasPermission('contracts.pdf.preview') ? <Action onClick={() => { previewContractPdf(activeActionContract.id, language); setOpenMenuId(''); }} icon={<FileText className="h-4 w-4" />} label={t('contracts.actions.previewPdf')} /> : null}
          {hasPermission('contracts.pdf.download') ? <Action onClick={() => { downloadContractPdf(activeActionContract.id, activeActionContract.contractNumber, language); setOpenMenuId(''); }} icon={<Download className="h-4 w-4" />} label={t('contracts.actions.downloadPdf')} /> : null}
          {activeActionContract.currentVersion?.signatureStatus === 'COMPANY_SIGNED' && hasPermission('contracts.email.send') ? <Action onClick={() => { emailMutation.mutate(activeActionContract); setOpenMenuId(''); }} icon={<Mail className="h-4 w-4" />} label={t('contracts.actions.email')} /> : null}
          {hasPermission('contracts.signature.revoke') && !['NOT_STARTED', 'COMPANY_PENDING', 'REVOKED'].includes(activeActionContract.currentVersion?.signatureStatus ?? 'NOT_STARTED') ? <Action danger onClick={() => { setSignatureRevokeContract(activeActionContract); setOpenMenuId(''); }} icon={<Ban className="h-4 w-4" />} label={t('contracts.actions.revokeSignature')} /> : null}
          {['DRAFT', 'SENT', 'VIEWED'].includes(activeActionContract.status) && hasPermission('contracts.cancel') ? <Action onClick={() => { confirmCancel(activeActionContract); setOpenMenuId(''); }} icon={<Ban className="h-4 w-4" />} label={t('contracts.actions.cancel')} /> : null}
          {activeActionContract.status === 'ACTIVE' && hasPermission('contracts.terminate') ? <Action danger onClick={() => { confirmTerminate(activeActionContract); setOpenMenuId(''); }} icon={<Ban className="h-4 w-4" />} label={t('contracts.actions.terminate')} /> : null}
          {activeActionContract.status === 'DRAFT' && hasPermission('contracts.delete') ? <Action danger onClick={() => { confirmDelete(activeActionContract); setOpenMenuId(''); }} icon={<Trash2 className="h-4 w-4" />} label={t('common.delete')} /> : null}
        </div>,
        document.body
      ) : null}

      {signatureRevokeContract ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-200 px-5 py-4">
              <p className="text-xs font-semibold uppercase text-slate-500">{t('contracts.signature.title')}</p>
              <h3 className="text-lg font-bold text-slate-950">{t('contracts.signature.revokeTitle')}</h3>
            </div>
            <div className="space-y-4 p-5">
              <div className="grid gap-3 text-sm md:grid-cols-2">
                <Info label={t('contracts.fields.number')} value={signatureRevokeContract.contractNumber} />
                <Info label={t('contracts.fields.version')} value={String(signatureRevokeContract.currentVersion?.versionNumber ?? '-')} />
                <Info label={t('contracts.signature.currentStatus')} value={t(`contracts.signature.status.${signatureRevokeContract.currentVersion?.signatureStatus ?? 'NOT_STARTED'}`)} />
                <Info label={t('contracts.signature.signedAt')} value={formatDateTime(signatureRevokeContract.currentVersion?.companySignedAt ?? signatureRevokeContract.signedAt ?? '')} />
              </div>
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{t('contracts.signature.revokeWarning')}</p>
              <Field label={t('contracts.signature.revocationReason')}>
                <textarea required className="min-h-24 w-full rounded-md border border-slate-200 p-3 text-sm" onChange={(event) => setRevocationReason(event.target.value)} value={revocationReason} />
              </Field>
              <Field label={t('contracts.signature.internalNote')}>
                <textarea className="min-h-20 w-full rounded-md border border-slate-200 p-3 text-sm" onChange={(event) => setRevocationNote(event.target.value)} value={revocationNote} />
              </Field>
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input className="mt-1 h-4 w-4 rounded border-slate-300" checked={revocationConfirmed} onChange={(event) => setRevocationConfirmed(event.target.checked)} type="checkbox" />
                <span>{t('contracts.signature.revokeConfirm')}</span>
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium" onClick={() => setSignatureRevokeContract(null)} type="button">{t('common.cancel')}</button>
              <button
                className="h-9 rounded-md bg-rose-600 px-3 text-sm font-medium text-white disabled:opacity-60"
                disabled={!revocationReason.trim() || !revocationConfirmed || revokeSignatureMutation.isPending}
                onClick={() => revokeSignatureMutation.mutate()}
                type="button"
              >
                {t('contracts.signature.confirmRevoke')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {openForm ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/40">
          <form className="flex h-full w-full max-w-3xl flex-col bg-white shadow-xl md:w-[780px]" onSubmit={submitForm}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">{t('contracts.module')}</p>
                <h3 className="text-lg font-bold text-slate-950">{editingId ? t('contracts.edit') : t('contracts.create')}</h3>
              </div>
              <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200" onClick={() => setOpenForm(false)} type="button"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={t('contracts.fields.client')}>
                  <select required className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" disabled={Boolean(editingId)} onChange={(event) => setForm({ ...form, clientId: event.target.value })} value={form.clientId}>
                    <option value="">{t('contracts.placeholders.client')}</option>
                    {(customersQuery.data?.data ?? []).map((customer) => <option key={customer.id} value={customer.id}>{customer.company ?? customer.name}</option>)}
                  </select>
                </Field>
                <Field label={t('contracts.fields.template')}>
                  <select className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" onChange={(event) => applyTemplate(event.target.value)} value={form.templateId}>
                    <option value="">{t('contracts.placeholders.template')}</option>
                    {(templatesQuery.data ?? []).map((template) => <option key={template.id} value={template.id}>{template[language === 'ar' ? 'nameAr' : language === 'en' ? 'nameEn' : 'nameFr']}</option>)}
                  </select>
                </Field>
                <Field label={t('contracts.fields.title')}><input required className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" onChange={(event) => setForm({ ...form, title: event.target.value })} value={form.title} /></Field>
                <Field label={t('contracts.fields.type')}><input required className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" onChange={(event) => setForm({ ...form, contractType: event.target.value })} value={form.contractType} /></Field>
                <Field label={t('contracts.fields.startDate')}><input className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" type="date" onChange={(event) => setForm({ ...form, startDate: event.target.value })} value={form.startDate} /></Field>
                <Field label={t('contracts.fields.endDate')}><input className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" type="date" onChange={(event) => setForm({ ...form, endDate: event.target.value })} value={form.endDate} /></Field>
                <Field label={t('contracts.fields.amount')}><input className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" min="0" step="0.01" type="number" onChange={(event) => setForm({ ...form, amount: event.target.value })} value={form.amount} /></Field>
                <Field label={t('contracts.fields.currency')}><input className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" onChange={(event) => setForm({ ...form, currency: event.target.value })} value={form.currency} /></Field>
                <Field label={t('contracts.fields.language')}>
                  <select className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" onChange={(event) => setForm({ ...form, language: event.target.value as 'fr' | 'en' | 'ar' })} value={form.language}>
                    <option value="fr">{t('language.nativeFrench')}</option>
                    <option value="en">{t('language.nativeEnglish')}</option>
                    <option value="ar">{t('language.nativeArabic')}</option>
                  </select>
                </Field>
                <Field label={t('contracts.fields.renewal')}>
                  <select className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" onChange={(event) => setForm({ ...form, renewalType: event.target.value as ContractRenewalType })} value={form.renewalType}>
                    <option value="NONE">{t('contracts.renewal.NONE')}</option>
                    <option value="MANUAL">{t('contracts.renewal.MANUAL')}</option>
                    <option value="AUTOMATIC">{t('contracts.renewal.AUTOMATIC')}</option>
                  </select>
                </Field>
                <Field label={t('contracts.fields.renewalNoticeDays')}><input className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" min="0" max="365" type="number" onChange={(event) => setForm({ ...form, renewalNoticeDays: event.target.value })} value={form.renewalNoticeDays} /></Field>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
                <div className="mb-3">
                  <h4 className="text-sm font-semibold text-slate-950">{t('contracts.pricing.title')}</h4>
                  <p className="text-xs text-slate-500">{t('contracts.pricing.description')}</p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label={t('contracts.pricing.type')}>
                    <select className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" onChange={(event) => setForm({ ...form, pricingType: event.target.value as ContractPricingType })} value={form.pricingType}>
                      {pricingTypes.map((type) => <option key={type} value={type}>{t(`contracts.pricing.types.${type}`)}</option>)}
                    </select>
                  </Field>
                  <Field label={t('contracts.pricing.billingFrequency')}>
                    <select className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" onChange={(event) => setForm({ ...form, billingFrequency: event.target.value as ContractBillingFrequency })} value={form.billingFrequency}>
                      {billingFrequencies.map((frequency) => <option key={frequency} value={frequency}>{t(`contracts.pricing.frequencies.${frequency}`)}</option>)}
                    </select>
                  </Field>
                  {showFixedAmount ? <Field label={t('contracts.pricing.fixedAmount')}><input className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" min="0" step="0.01" type="number" onChange={(event) => setForm({ ...form, fixedAmount: event.target.value, amount: form.amount || event.target.value })} value={form.fixedAmount} /></Field> : null}
                  {showUnitRate ? <Field label={t('contracts.pricing.unitRate')}><input className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" min="0" step="0.01" type="number" onChange={(event) => setForm({ ...form, unitRate: event.target.value })} value={form.unitRate} /></Field> : null}
                  {showUsageFields ? <Field label={t('contracts.pricing.includedUnits')}><input className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" min="0" step="0.01" type="number" onChange={(event) => setForm({ ...form, includedUnits: event.target.value })} value={form.includedUnits} /></Field> : null}
                  {showUsageFields ? <Field label={t('contracts.pricing.overtimeRate')}><input className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" min="0" step="0.01" type="number" onChange={(event) => setForm({ ...form, overtimeRate: event.target.value })} value={form.overtimeRate} /></Field> : null}
                  {showBillingDates ? <Field label={t('contracts.pricing.billingStartDate')}><input className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" type="date" onChange={(event) => setForm({ ...form, billingStartDate: event.target.value })} value={form.billingStartDate} /></Field> : null}
                  {showBillingDates ? <Field label={t('contracts.pricing.billingEndDate')}><input className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" type="date" onChange={(event) => setForm({ ...form, billingEndDate: event.target.value })} value={form.billingEndDate} /></Field> : null}
                  <Field label={t('contracts.pricing.taxRate')}><input className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" max="100" min="0" step="0.01" type="number" onChange={(event) => setForm({ ...form, taxRate: event.target.value })} value={form.taxRate} /></Field>
                  <Field label={t('contracts.pricing.paymentTermsDays')}><input className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" min="0" type="number" onChange={(event) => setForm({ ...form, paymentTermsDays: event.target.value })} value={form.paymentTermsDays} /></Field>
                  <Field label={t('contracts.pricing.billingDay')}><input className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" max="31" min="1" type="number" onChange={(event) => setForm({ ...form, billingDay: event.target.value })} value={form.billingDay} /></Field>
                  <Field label={t('contracts.pricing.prorationPolicy')}>
                    <select className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" onChange={(event) => setForm({ ...form, prorationPolicy: event.target.value as ContractProrationPolicy })} value={form.prorationPolicy}>
                      {prorationPolicies.map((policy) => <option key={policy} value={policy}>{t(`contracts.pricing.proration.${policy}`)}</option>)}
                    </select>
                  </Field>
                  <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700">
                    <input className="h-4 w-4 rounded border-slate-300" checked={form.autoInvoiceEnabled} onChange={(event) => setForm({ ...form, autoInvoiceEnabled: event.target.checked })} type="checkbox" />
                    {t('contracts.pricing.autoInvoiceEnabled')}
                  </label>
                  {form.autoInvoiceEnabled ? <Field label={t('contracts.pricing.nextInvoiceDate')}><input className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" type="date" onChange={(event) => setForm({ ...form, nextInvoiceDate: event.target.value })} value={form.nextInvoiceDate} /></Field> : null}
                </div>
                {showBillingDescription ? <div className="mt-4"><Field label={t('contracts.pricing.billingDescription')}><textarea className="min-h-20 w-full rounded-md border border-slate-200 p-3 text-sm" onChange={(event) => setForm({ ...form, billingDescription: event.target.value })} value={form.billingDescription} /></Field></div> : null}
              </div>
              <Field label={t('contracts.fields.summary')}><textarea className="min-h-20 w-full rounded-md border border-slate-200 p-3 text-sm" onChange={(event) => setForm({ ...form, summary: event.target.value })} value={form.summary} /></Field>
              <Field label={t('contracts.fields.content')}><textarea required className="min-h-56 w-full rounded-md border border-slate-200 p-3 text-sm" onChange={(event) => setForm({ ...form, content: event.target.value })} value={form.content} /></Field>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium" onClick={() => setOpenForm(false)} type="button">{t('common.cancel')}</button>
              <button className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-white disabled:opacity-60" disabled={saveMutation.isPending} type="submit">{t('common.save')}</button>
            </div>
          </form>
        </div>
      ) : null}

      {viewId ? createPortal(
        <ContractDetails
          contract={detailsQuery.data ?? selectedListContract}
          isEmailing={emailMutation.isPending}
          isLoading={detailsQuery.isLoading && !selectedListContract}
          isSigning={signMutation.isPending}
          onClose={() => setViewId('')}
          onDownloadPdf={(contract) => downloadContractPdf(contract.id, contract.contractNumber, language)}
          onEmail={(contract) => emailMutation.mutate(contract)}
          onPreviewPdf={(contract) => previewContractPdf(contract.id, language)}
          onSign={(contract) => signMutation.mutate(contract.id)}
          onGenerateInvoice={(contract, input) => generateInvoiceMutation.mutate({ contract, input })}
          onOpenInvoice={onOpenInvoice}
          isGeneratingInvoice={generateInvoiceMutation.isPending}
          translate={t}
          hasPermission={hasPermission}
        />,
        document.body
      ) : null}
    </section>
  );
}

function Field({ label, children, required = false }: { label: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      <span>{label}{required ? <span className="text-rose-500"> *</span> : null}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function ReadOnlyBox({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white text-slate-500">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
        <p className="mt-0.5 truncate text-sm font-semibold text-slate-900" title={value}>{value}</p>
      </div>
    </div>
  );
}

function CalculationRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 rounded-md px-3 py-2 ${strong ? 'bg-white shadow-sm' : 'bg-white/70'}`}>
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <span className={`text-sm ${strong ? 'font-bold text-slate-950' : 'font-semibold text-slate-800'}`}>{value}</span>
    </div>
  );
}

function Action({ label, icon, onClick, danger = false }: { label: string; icon: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition hover:bg-slate-50 ${danger ? 'text-rose-600' : 'text-slate-700'}`} onClick={onClick} type="button">
      {icon}
      {label}
    </button>
  );
}

function CompactRows({
  empty,
  rows,
}: {
  empty: string;
  rows: Array<{ id: string; title: string; meta: string; value: string; action?: { label: string; onClick: () => void; disabled?: boolean }; actions?: Array<{ label: string; onClick: () => void; disabled?: boolean }> }>;
}) {
  if (!rows.length) {
    return <p className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">{empty}</p>;
  }

  return (
    <div className="divide-y divide-slate-100">
      {rows.map((row) => (
        <div className="flex flex-col gap-2 py-3 text-sm md:flex-row md:items-center md:justify-between" key={row.id}>
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-900" title={row.title}>{row.title}</p>
            <p className="text-xs text-slate-500">{row.meta}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{row.value}</span>
            {[...(row.actions ?? []), ...(row.action ? [row.action] : [])].map((action) => (
              <button className="h-8 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60" disabled={action.disabled} key={action.label} onClick={action.onClick} type="button">
                {action.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

function ContractDetails({
  contract,
  hasPermission,
  isEmailing,
  isGeneratingInvoice,
  isLoading,
  isSigning,
  onClose,
  onDownloadPdf,
  onEmail,
  onGenerateInvoice,
  onOpenInvoice,
  onPreviewPdf,
  onSign,
  translate,
}: {
  contract?: Contract;
  hasPermission: (permission: string) => boolean;
  isEmailing: boolean;
  isLoading: boolean;
  isSigning: boolean;
  onClose: () => void;
  onDownloadPdf: (contract: Contract) => void;
  onEmail: (contract: Contract) => void;
  onGenerateInvoice: (contract: Contract, input?: ContractBillingInvoiceInput) => void;
  onOpenInvoice?: (invoiceId: string) => void;
  onPreviewPdf: (contract: Contract) => void;
  onSign: (contract: Contract) => void;
  isGeneratingInvoice: boolean;
  translate: Translate;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const initialTimeEntryForm = { id: '', workDate: new Date().toISOString().slice(0, 10), startTime: '', endTime: '', breakMinutes: '0', quantity: '', activityType: '', description: '', internalNote: '', billable: true };
  const [timeEntryForm, setTimeEntryForm] = useState(initialTimeEntryForm);
  const [milestoneForm, setMilestoneForm] = useState({ title: '', dueDate: '', amount: '', percentage: '' });
  const [scheduleForm, setScheduleForm] = useState({ label: '', dueDate: new Date().toISOString().slice(0, 10), amount: '' });
  const signatureStatus = contract?.currentVersion?.signatureStatus ?? 'NOT_STARTED';
  const editingTimeEntry = contract?.timeEntries?.find((entry) => entry.id === timeEntryForm.id);
  const timeEntryStatus = editingTimeEntry?.status ?? 'DRAFT';
  const timeEntryRate = Number(contract?.unitRate ?? 0);
  const timeEntryTaxRate = Number(contract?.taxRate ?? 0);
  const isHourlyTimeEntry = contract?.pricingType === 'HOURLY';
  const timeEntryUnitKey = getTimeEntryUnitKey(contract?.pricingType);
  const timeEntryUnitLabel = translate(`contracts.pricing.units.${timeEntryUnitKey}`);
  const timeEntryDurationMinutes = isHourlyTimeEntry
    ? calculateDurationMinutes(timeEntryForm.startTime, timeEntryForm.endTime, Number(timeEntryForm.breakMinutes || 0))
    : Math.round(Number(timeEntryForm.quantity || 0) * getTimeEntryUnitMinutes(contract?.pricingType));
  const timeEntryQuantity = isHourlyTimeEntry ? timeEntryDurationMinutes / 60 : Number(timeEntryForm.quantity || 0);
  const timeEntryBillableQuantity = timeEntryForm.billable ? timeEntryQuantity : 0;
  const timeEntryBillableMinutes = timeEntryForm.billable ? timeEntryDurationMinutes : 0;
  const timeEntryAmountHT = roundMoney(timeEntryBillableQuantity * timeEntryRate);
  const timeEntryVat = roundMoney(timeEntryAmountHT * (timeEntryTaxRate / 100));
  const timeEntryAmountTTC = roundMoney(timeEntryAmountHT + timeEntryVat);
  const canSubmitTimeEntryForm = Boolean(
    timeEntryForm.activityType
    && timeEntryForm.description.trim()
    && (isHourlyTimeEntry
      ? timeEntryForm.startTime && timeEntryForm.endTime && timeEntryDurationMinutes > 0
      : Number(timeEntryForm.quantity || 0) > 0)
  );
  const timeEntries = contract?.timeEntries ?? [];
  const linkedInvoiceById = new Map((contract?.invoices ?? []).map((invoice) => [invoice.id, invoice]));
  const hasApprovedBillableTime = timeEntries.some((entry) => entry.status === 'APPROVED' && entry.billable && !entry.invoiceId);
  const approvedBillableTimePeriod = getApprovedBillableTimePeriod(timeEntries);
  const activityOptions = ['DEVELOPMENT', 'SUPPORT', 'CONSULTING', 'TRAINING', 'MEETING', 'ADMINISTRATION'];
  const handleOpenInvoice = (invoiceId: string) => {
    onOpenInvoice?.(invoiceId);
    onClose();
  };
  const canCompanySign = Boolean(
    contract
      && ['DRAFT', 'SENT', 'VIEWED'].includes(contract.status)
      && ['NOT_STARTED', 'COMPANY_PENDING'].includes(signatureStatus)
      && hasPermission('contracts.sign.company')
  );
  const canEmail = Boolean(contract && signatureStatus === 'COMPANY_SIGNED' && hasPermission('contracts.email.send'));
  const canGenerateInvoice = Boolean(contract && signatureStatus === 'COMPLETED' && ['ACTIVE', 'SENT', 'VIEWED'].includes(contract.status) && hasPermission('contracts.billing.generate'));
  const supportsTimeTracking = Boolean(contract && isTimeEntryPricingType(contract.pricingType));
  const refreshContract = (contractId: string) => {
    queryClient.invalidateQueries({ queryKey: ['contracts', 'detail', contractId] });
    queryClient.invalidateQueries({ queryKey: ['contracts'] });
  };
  const actionError = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

  const timeEntryMutation = useMutation({
    mutationFn: () => {
      const payload = {
        workDate: timeEntryForm.workDate,
        startTime: isHourlyTimeEntry && timeEntryForm.startTime ? new Date(`${timeEntryForm.workDate}T${timeEntryForm.startTime}`).toISOString() : null,
        endTime: isHourlyTimeEntry && timeEntryForm.endTime ? new Date(`${timeEntryForm.workDate}T${timeEntryForm.endTime}`).toISOString() : null,
        breakMinutes: isHourlyTimeEntry ? Number(timeEntryForm.breakMinutes || 0) : 0,
        quantity: isHourlyTimeEntry ? undefined : Number(timeEntryForm.quantity || 0),
        activityType: timeEntryForm.activityType || null,
        description: timeEntryForm.description,
        internalNote: timeEntryForm.internalNote || null,
        billable: timeEntryForm.billable,
      };
      return timeEntryForm.id
        ? updateContractTimeEntry(contract!.id, timeEntryForm.id, payload)
        : createContractTimeEntry(contract!.id, payload);
    },
    onSuccess: () => {
      if (!contract) return;
      toast.success(translate(timeEntryForm.id ? 'contracts.messages.timeEntryUpdated' : 'contracts.messages.timeEntryCreated'));
      setTimeEntryForm(initialTimeEntryForm);
      refreshContract(contract.id);
    },
    onError: (error) => toast.error(actionError(error, translate('contracts.messages.actionFailed'))),
  });

  const submitTimeEntryMutation = useMutation({
    mutationFn: (entryId: string) => submitContractTimeEntry(contract!.id, entryId),
    onSuccess: () => {
      if (!contract) return;
      toast.success(translate('contracts.messages.timeEntrySubmitted'));
      refreshContract(contract.id);
    },
    onError: (error) => toast.error(actionError(error, translate('contracts.messages.actionFailed'))),
  });

  const approveTimeEntryMutation = useMutation({
    mutationFn: (entryId: string) => approveContractTimeEntry(contract!.id, entryId),
    onSuccess: () => {
      if (!contract) return;
      toast.success(translate('contracts.messages.timeEntryApproved'));
      refreshContract(contract.id);
    },
    onError: (error) => toast.error(actionError(error, translate('contracts.messages.actionFailed'))),
  });

  const rejectTimeEntryMutation = useMutation({
    mutationFn: ({ entryId, reason }: { entryId: string; reason: string }) => rejectContractTimeEntry(contract!.id, entryId, reason),
    onSuccess: () => {
      if (!contract) return;
      toast.success(translate('contracts.messages.timeEntryRejected'));
      refreshContract(contract.id);
    },
    onError: (error) => toast.error(actionError(error, translate('contracts.messages.actionFailed'))),
  });

  const milestoneMutation = useMutation({
    mutationFn: () => createContractMilestone(contract!.id, {
      title: milestoneForm.title,
      dueDate: milestoneForm.dueDate || null,
      amount: milestoneForm.amount ? Number(milestoneForm.amount) : null,
      percentage: milestoneForm.percentage ? Number(milestoneForm.percentage) : null,
    }),
    onSuccess: () => {
      if (!contract) return;
      toast.success(translate('contracts.messages.milestoneCreated'));
      setMilestoneForm({ title: '', dueDate: '', amount: '', percentage: '' });
      refreshContract(contract.id);
    },
    onError: (error) => toast.error(actionError(error, translate('contracts.messages.actionFailed'))),
  });

  const approveMilestoneMutation = useMutation({
    mutationFn: (milestoneId: string) => approveContractMilestone(contract!.id, milestoneId),
    onSuccess: () => {
      if (!contract) return;
      toast.success(translate('contracts.messages.milestoneApproved'));
      refreshContract(contract.id);
    },
    onError: (error) => toast.error(actionError(error, translate('contracts.messages.actionFailed'))),
  });

  const scheduleMutation = useMutation({
    mutationFn: () => createContractBillingScheduleItem(contract!.id, {
      label: scheduleForm.label,
      dueDate: scheduleForm.dueDate,
      amount: Number(scheduleForm.amount),
    }),
    onSuccess: () => {
      if (!contract) return;
      toast.success(translate('contracts.messages.scheduleCreated'));
      setScheduleForm({ label: '', dueDate: new Date().toISOString().slice(0, 10), amount: '' });
      refreshContract(contract.id);
    },
    onError: (error) => toast.error(actionError(error, translate('contracts.messages.actionFailed'))),
  });

  const targetedInvoiceMutation = useMutation({
    mutationFn: (input: { milestoneId?: string; scheduleItemId?: string }) => generateContractInvoice(contract!.id, input),
    onSuccess: (invoice) => {
      if (!contract) return;
      toast.success(translate('contracts.messages.invoiceGenerated', { number: invoice.invoiceNumber }));
      refreshContract(contract.id);
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (error) => toast.error(actionError(error, translate('contracts.messages.invoiceGenerationFailed'))),
  });

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-slate-950/40">
      <aside className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">{translate('contracts.module')}</p>
            <h3 className="text-lg font-bold text-slate-950">{contract?.contractNumber ?? translate('contracts.details')}</h3>
          </div>
          <button className="h-9 rounded-md border border-slate-200 px-3 text-sm" onClick={onClose} type="button">{translate('contracts.labels.close')}</button>
        </div>
        <div className="space-y-4 p-5">
          {isLoading ? <p className="text-sm text-slate-500">{translate('common.loading')}</p> : null}
          {contract ? (
            <>
              <div className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="font-semibold text-slate-950">{contract.title}</h4>
                    <p className="text-sm text-slate-500">{contract.client.company ?? contract.client.name} - {contract.client.email}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2 rtl:items-start">
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusClasses[contract.status]}`}>{translate(`contracts.status.${contract.status}`)}</span>
                    <SignatureBadge status={signatureStatus} translate={translate} />
                  </div>
                </div>
                <div className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-[1fr_auto] md:items-center">
                  <div className="flex items-start gap-3">
                    <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
                      <Stamp className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-950">{translate('contracts.signature.title')}</p>
                      <p className="text-xs text-slate-500">{translate(`contracts.signature.status.${signatureStatus}`)}</p>
                      {contract.currentVersion?.companySignedAt ? (
                        <p className="mt-1 text-xs text-slate-500">{translate('contracts.signature.signedAt')}: {formatDateTime(contract.currentVersion.companySignedAt)}</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-start gap-2 md:justify-end">
                    {canCompanySign ? (
                      <button
                        className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white transition hover:bg-primary/90 disabled:opacity-60"
                        disabled={isSigning}
                        onClick={() => onSign(contract)}
                        type="button"
                      >
                        <FileSignature className="h-4 w-4" />
                        {translate('contracts.actions.signCompany')}
                      </button>
                    ) : null}
                    {hasPermission('contracts.pdf.preview') ? (
                      <button className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50" onClick={() => onPreviewPdf(contract)} type="button">
                        <FileText className="h-4 w-4" />
                        {translate('contracts.actions.previewPdf')}
                      </button>
                    ) : null}
                    {hasPermission('contracts.pdf.download') ? (
                      <button className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50" onClick={() => onDownloadPdf(contract)} type="button">
                        <Download className="h-4 w-4" />
                        {translate('contracts.actions.downloadPdf')}
                      </button>
                    ) : null}
                    {canEmail ? (
                      <button className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60" disabled={isEmailing} onClick={() => onEmail(contract)} type="button">
                        <Mail className="h-4 w-4" />
                        {translate('contracts.actions.email')}
                      </button>
                    ) : null}
                    {canGenerateInvoice ? (
                      <button className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white transition hover:bg-primary/90 disabled:opacity-60" disabled={isGeneratingInvoice} onClick={() => onGenerateInvoice(contract, approvedBillableTimePeriod)} type="button">
                        <Plus className="h-4 w-4" />
                        {translate('contracts.actions.generateInvoice')}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Info label={translate('contracts.fields.period')} value={`${formatDate(contract.startDate)} - ${formatDate(contract.endDate)}`} />
                <Info label={translate('contracts.fields.amount')} value={formatContractAmount(contract)} />
                <Info label={translate('contracts.fields.version')} value={String(contract.currentVersion?.versionNumber ?? '-')} />
                <Info label={translate('contracts.fields.hash')} value={contract.pdfHash ?? contract.currentVersion?.contentHash ?? '-'} />
              </div>
              <div className="rounded-lg border border-slate-200 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h4 className="font-semibold text-slate-950">{translate('contracts.pricing.title')}</h4>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{translate(`contracts.pricing.types.${contract.pricingType}`)}</span>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <Info label={translate('contracts.pricing.billingFrequency')} value={translate(`contracts.pricing.frequencies.${contract.billingFrequency}`)} />
                  <Info label={translate('contracts.pricing.taxRate')} value={`${contract.taxRate ?? 0}%`} />
                  <Info label={translate('contracts.pricing.paymentTermsDays')} value={translate('contracts.pricing.days', { count: contract.paymentTermsDays ?? 30 })} />
                  <Info label={translate('contracts.pricing.fixedAmount')} value={contract.fixedAmount == null ? '-' : formatCurrency(Number(contract.fixedAmount), contract.currency)} />
                  <Info label={translate('contracts.pricing.unitRate')} value={contract.unitRate == null ? '-' : formatCurrency(Number(contract.unitRate), contract.currency)} />
                  <Info label={translate('contracts.pricing.nextInvoiceDate')} value={formatDate(contract.nextInvoiceDate)} />
                </div>
                {contract.billingDescription ? <p className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-600">{contract.billingDescription}</p> : null}
              </div>
              <div className="rounded-lg border border-slate-200 p-4">
                <h4 className="mb-3 font-semibold text-slate-950">{translate('contracts.pricing.linkedInvoices')}</h4>
                {(contract.invoices ?? []).length ? (
                  <div className="divide-y divide-slate-100">
                    {(contract.invoices ?? []).map((invoice) => (
                      <div className="flex items-center justify-between gap-3 py-2 text-sm" key={invoice.id}>
                        <div>
                          <button
                            className="font-semibold text-primary transition hover:underline focus:outline-none focus:ring-2 focus:ring-primary/30"
                            onClick={() => handleOpenInvoice(invoice.id)}
                            type="button"
                          >
                            {invoice.invoiceNumber}
                          </button>
                          <p className="text-xs text-slate-500">{formatDate(invoice.billingPeriodStart)} - {formatDate(invoice.billingPeriodEnd)}</p>
                        </div>
                        <div className="text-right rtl:text-left">
                          <p className="font-semibold text-slate-900">{formatCurrency(Number(invoice.total), contract.currency)}</p>
                          <p className="text-xs text-slate-500">{invoice.status}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-slate-500">{translate('contracts.pricing.noLinkedInvoices')}</p>}
              </div>
              <div className="rounded-lg border border-slate-200 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="font-semibold text-slate-950">{translate('contracts.billing.timeEntries')}</h4>
                    <p className="text-xs text-slate-500">{translate('contracts.billing.contractTimesheetDescription')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-500">{translate('contracts.billing.count', { count: timeEntries.length })}</span>
                    {canGenerateInvoice && hasApprovedBillableTime ? (
                      <button className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white transition hover:bg-primary/90 disabled:opacity-60" disabled={isGeneratingInvoice} onClick={() => onGenerateInvoice(contract, approvedBillableTimePeriod)} type="button">
                        <Plus className="h-4 w-4" />
                        {translate('contracts.actions.generateInvoice')}
                      </button>
                    ) : null}
                  </div>
                </div>
                {!supportsTimeTracking ? (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                    <p className="font-medium text-slate-800">{translate('contracts.billing.timeTrackingUnavailableTitle')}</p>
                    <p className="mt-1">{translate('contracts.billing.timeTrackingUnavailableDescription')}</p>
                  </div>
                ) : (
                  <>
                    {hasPermission('contracts.time_entries.create') ? (
                    <form className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white" onSubmit={(event) => { event.preventDefault(); timeEntryMutation.mutate(); }}>
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <Clock className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-950">{translate('contracts.billing.entryTitle')}</p>
                            <p className="text-xs text-slate-500">{timeEntryForm.id ? translate('contracts.billing.editingEntry') : translate('contracts.billing.newEntry')}</p>
                          </div>
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${timeEntryStatusClasses[timeEntryStatus]}`}>
                          {translate(`contracts.billing.timeStatus.${timeEntryStatus}`)}
                        </span>
                      </div>

                      <div className="grid gap-4 p-4 lg:grid-cols-[1.2fr_0.8fr]">
                        <div className="space-y-4">
                          <div className="grid gap-3 md:grid-cols-2">
                            <ReadOnlyBox icon={<BriefcaseBusiness className="h-4 w-4" />} label={translate('contracts.fields.contract')} value={`${contract.contractNumber} - ${contract.title}`} />
                            <ReadOnlyBox icon={<UserRound className="h-4 w-4" />} label={translate('contracts.fields.client')} value={`${contract.client.company ?? contract.client.name}${contract.client.email ? ` - ${contract.client.email}` : ''}`} />
                          </div>

                          <div className="grid gap-3 md:grid-cols-3">
                            <Field label={translate('contracts.billing.workDate')} required>
                              <input aria-label={translate('contracts.billing.workDate')} className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" required type="date" value={timeEntryForm.workDate} onChange={(event) => setTimeEntryForm({ ...timeEntryForm, workDate: event.target.value })} />
                            </Field>
                            {isHourlyTimeEntry ? (
                              <>
                                <Field label={translate('contracts.billing.startTime')} required>
                                  <input aria-label={translate('contracts.billing.startTime')} className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" required type="time" value={timeEntryForm.startTime} onChange={(event) => setTimeEntryForm({ ...timeEntryForm, startTime: event.target.value })} />
                                </Field>
                                <Field label={translate('contracts.billing.endTime')} required>
                                  <input aria-label={translate('contracts.billing.endTime')} className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" required type="time" value={timeEntryForm.endTime} onChange={(event) => setTimeEntryForm({ ...timeEntryForm, endTime: event.target.value })} />
                                </Field>
                                <Field label={translate('contracts.billing.breakMinutes')}>
                                  <input aria-label={translate('contracts.billing.breakMinutes')} className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" min="0" step="5" type="number" value={timeEntryForm.breakMinutes} onChange={(event) => setTimeEntryForm({ ...timeEntryForm, breakMinutes: event.target.value })} />
                                </Field>
                              </>
                            ) : (
                              <Field label={translate('contracts.billing.quantityByUnit', { unit: timeEntryUnitLabel })} required>
                                <input aria-label={translate('contracts.billing.quantityByUnit', { unit: timeEntryUnitLabel })} className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" min="0.01" step="0.01" required type="number" value={timeEntryForm.quantity} onChange={(event) => setTimeEntryForm({ ...timeEntryForm, quantity: event.target.value })} />
                              </Field>
                            )}
                            <Field label={translate('contracts.billing.activityType')} required>
                              <select aria-label={translate('contracts.billing.activityType')} className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" required value={timeEntryForm.activityType} onChange={(event) => setTimeEntryForm({ ...timeEntryForm, activityType: event.target.value })}>
                                <option value="">{translate('contracts.billing.selectActivity')}</option>
                                {activityOptions.map((activity) => (
                                  <option key={activity} value={activity}>{translate(`contracts.billing.activities.${activity}`)}</option>
                                ))}
                              </select>
                            </Field>
                            <label className="mt-6 flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700">
                              <input checked={timeEntryForm.billable} type="checkbox" onChange={(event) => setTimeEntryForm({ ...timeEntryForm, billable: event.target.checked })} />
                              {translate('contracts.billing.billable')}
                            </label>
                          </div>

                          <Field label={translate('contracts.billing.description')} required>
                            <textarea aria-label={translate('contracts.billing.description')} className="min-h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none ring-primary/20 transition focus:ring-4" required value={timeEntryForm.description} onChange={(event) => setTimeEntryForm({ ...timeEntryForm, description: event.target.value })} />
                          </Field>
                          <Field label={translate('contracts.billing.internalNote')}>
                            <textarea aria-label={translate('contracts.billing.internalNote')} className="min-h-16 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none ring-primary/20 transition focus:ring-4" value={timeEntryForm.internalNote} onChange={(event) => setTimeEntryForm({ ...timeEntryForm, internalNote: event.target.value })} />
                          </Field>
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                          <div className="mb-3 flex items-center gap-2">
                            <Calculator className="h-4 w-4 text-primary" />
                            <p className="text-sm font-semibold text-slate-950">{translate('contracts.billing.calculation')}</p>
                          </div>
                          <div className="space-y-2">
                            {isHourlyTimeEntry ? (
                              <>
                                <CalculationRow label={translate('contracts.billing.duration')} value={formatDuration(timeEntryDurationMinutes)} />
                                <CalculationRow label={translate('contracts.billing.billableDuration')} value={formatDuration(timeEntryBillableMinutes)} />
                              </>
                            ) : (
                              <>
                                <CalculationRow label={translate('contracts.billing.quantity')} value={formatBillingQuantity(timeEntryQuantity, timeEntryUnitLabel)} />
                                <CalculationRow label={translate('contracts.billing.billableQuantity')} value={formatBillingQuantity(timeEntryBillableQuantity, timeEntryUnitLabel)} />
                              </>
                            )}
                            <CalculationRow label={translate('contracts.billing.hourlyRate')} value={`${formatCurrency(timeEntryRate, contract.currency)} / ${timeEntryUnitLabel}`} />
                            <CalculationRow label={translate('contracts.billing.amountHT')} value={formatCurrency(timeEntryAmountHT, contract.currency)} />
                            <CalculationRow label={translate('contracts.billing.taxRate')} value={`${timeEntryTaxRate}%`} />
                            <CalculationRow label={translate('contracts.billing.taxAmount')} value={formatCurrency(timeEntryVat, contract.currency)} />
                            <CalculationRow strong label={translate('contracts.billing.amountTTC')} value={formatCurrency(timeEntryAmountTTC, contract.currency)} />
                          </div>
                          <p className="mt-3 rounded-md bg-white p-2 text-xs text-slate-500">{translate('contracts.billing.backendRecalculationNotice')}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
                        {timeEntryForm.id ? (
                          <button className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700" onClick={() => setTimeEntryForm(initialTimeEntryForm)} type="button">{translate('common.cancel')}</button>
                        ) : null}
                        <button className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-60" disabled={timeEntryMutation.isPending || !canSubmitTimeEntryForm} type="submit">
                          {timeEntryForm.id ? translate('common.save') : translate('contracts.billing.addTimesheet')}
                        </button>
                      </div>
                    </form>
                    ) : (
                      <p className="mb-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-500">{translate('contracts.billing.timeEntryCreateRestricted')}</p>
                    )}
                    <div className="overflow-hidden rounded-xl border border-slate-200">
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                            <tr>
                              <th className="px-3 py-3 text-left font-semibold rtl:text-right">{translate('contracts.billing.workDate')}</th>
                              <th className="px-3 py-3 text-left font-semibold rtl:text-right">{translate('contracts.billing.employee')}</th>
                              <th className="px-3 py-3 text-left font-semibold rtl:text-right">{translate('contracts.billing.activityType')}</th>
                              <th className="px-3 py-3 text-left font-semibold rtl:text-right">{translate('contracts.billing.duration')}</th>
                              <th className="px-3 py-3 text-right font-semibold rtl:text-left">{translate('contracts.billing.amount')}</th>
                              <th className="px-3 py-3 text-left font-semibold rtl:text-right">{translate('contracts.fields.status')}</th>
                              <th className="px-3 py-3 text-left font-semibold rtl:text-right">{translate('contracts.billing.invoice')}</th>
                              <th className="px-3 py-3 text-right font-semibold rtl:text-left">{translate('common.actions')}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white">
                            {timeEntries.length ? timeEntries.map((entry) => {
                              const invoice = entry.invoiceId ? linkedInvoiceById.get(entry.invoiceId) : undefined;
                              return (
                                <tr className="transition hover:bg-slate-50" key={entry.id}>
                                  <td className="px-3 py-3 font-medium text-slate-900">{formatDate(entry.workDate)}</td>
                                  <td className="px-3 py-3 text-slate-600">
                                    <p className="font-medium text-slate-900">{entry.user?.name ?? translate('contracts.billing.employeeFallback')}</p>
                                    {entry.user?.email ? <p className="max-w-[180px] truncate text-xs text-slate-500" title={entry.user.email}>{entry.user.email}</p> : null}
                                  </td>
                                  <td className="px-3 py-3">
                                    <p className="font-medium text-slate-900">{formatActivity(entry.activityType, translate)}</p>
                                    <p className="max-w-[220px] truncate text-xs text-slate-500" title={entry.description}>{entry.description}</p>
                                  </td>
                                  <td className="px-3 py-3 text-slate-600">
                                    {isHourlyTimeEntry ? (
                                      <>
                                        <p>{formatDuration(entry.durationMinutes ?? 0)}</p>
                                        <p className="text-xs text-slate-500">{translate('contracts.billing.billableDuration')}: {formatDuration(entry.billableMinutes ?? 0)}</p>
                                      </>
                                    ) : (
                                      <>
                                        <p>{formatBillingQuantity(Number(entry.quantity ?? 0), timeEntryUnitLabel)}</p>
                                        <p className="text-xs text-slate-500">{translate('contracts.billing.billableQuantity')}: {formatBillingQuantity(entry.billable ? Number(entry.quantity ?? 0) : 0, timeEntryUnitLabel)}</p>
                                      </>
                                    )}
                                  </td>
                                  <td className="px-3 py-3 text-right font-semibold text-slate-900 rtl:text-left">{formatCurrency(Number(entry.calculatedAmount ?? 0), entry.currency ?? contract.currency)}</td>
                                  <td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${timeEntryStatusClasses[entry.status]}`}>{translate(`contracts.billing.timeStatus.${entry.status}`)}</span></td>
                                  <td className="px-3 py-3 text-slate-600">
                                    {invoice ? (
                                      <button
                                        className="font-medium text-primary transition hover:underline focus:outline-none focus:ring-2 focus:ring-primary/30"
                                        onClick={() => handleOpenInvoice(invoice.id)}
                                        type="button"
                                      >
                                        {invoice.invoiceNumber}
                                      </button>
                                    ) : entry.invoiceId ? shortenId(entry.invoiceId) : '-'}
                                  </td>
                                  <td className="px-3 py-3">
                                    <div className="flex flex-wrap justify-end gap-2 rtl:justify-start">
                                      {(entry.status === 'DRAFT' || entry.status === 'REJECTED') && hasPermission('contracts.time_entries.update') ? (
                                        <button className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60" disabled={timeEntryMutation.isPending} onClick={() => setTimeEntryForm({
                                          id: entry.id,
                                          workDate: entry.workDate.slice(0, 10),
                                          startTime: entry.startTime ? new Date(entry.startTime).toISOString().slice(11, 16) : '',
                                          endTime: entry.endTime ? new Date(entry.endTime).toISOString().slice(11, 16) : '',
                                          breakMinutes: String(entry.breakMinutes ?? 0),
                                          quantity: entry.quantity == null ? '' : String(entry.quantity),
                                          activityType: entry.activityType ?? '',
                                          description: entry.description,
                                          internalNote: entry.internalNote ?? '',
                                          billable: entry.billable,
                                        })} type="button">{translate('common.edit')}</button>
                                      ) : null}
                                      {(entry.status === 'DRAFT' || entry.status === 'REJECTED') && hasPermission('contracts.time_entries.submit') ? (
                                        <button className="h-8 rounded-md border border-blue-200 bg-blue-50 px-2 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-60" disabled={submitTimeEntryMutation.isPending} onClick={() => submitTimeEntryMutation.mutate(entry.id)} type="button">{translate('contracts.billing.submit')}</button>
                                      ) : null}
                                      {entry.status === 'SUBMITTED' && hasPermission('contracts.time_entries.approve') ? (
                                        <button className="h-8 rounded-md border border-emerald-200 bg-emerald-50 px-2 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60" disabled={approveTimeEntryMutation.isPending} onClick={() => approveTimeEntryMutation.mutate(entry.id)} type="button">{translate('contracts.billing.approve')}</button>
                                      ) : null}
                                      {entry.status === 'SUBMITTED' && hasPermission('contracts.time_entries.reject') ? (
                                        <button className="h-8 rounded-md border border-rose-200 bg-rose-50 px-2 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-60" disabled={rejectTimeEntryMutation.isPending} onClick={() => {
                                          const reason = window.prompt(translate('contracts.billing.rejectionReason'));
                                          if (reason?.trim()) rejectTimeEntryMutation.mutate({ entryId: entry.id, reason: reason.trim() });
                                        }} type="button">{translate('contracts.billing.reject')}</button>
                                      ) : null}
                                    </div>
                                  </td>
                                </tr>
                              );
                            }) : (
                              <tr>
                                <td className="px-3 py-8 text-center text-sm text-slate-500" colSpan={8}>{translate('contracts.billing.noTimeEntries')}</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </div>
              {contract.pricingType === 'MILESTONE' ? (
                <div className="rounded-lg border border-slate-200 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h4 className="font-semibold text-slate-950">{translate('contracts.billing.milestones')}</h4>
                    <span className="text-xs font-medium text-slate-500">{translate('contracts.billing.count', { count: contract.milestones?.length ?? 0 })}</span>
                  </div>
                  {hasPermission('contracts.milestones.manage') ? (
                    <form className="mb-4 grid gap-2 rounded-lg bg-slate-50 p-3 md:grid-cols-[1.4fr_1fr_110px_110px_auto]" onSubmit={(event) => { event.preventDefault(); milestoneMutation.mutate(); }}>
                      <input className="h-9 rounded-md border border-slate-200 px-3 text-sm" required placeholder={translate('contracts.billing.title')} value={milestoneForm.title} onChange={(event) => setMilestoneForm({ ...milestoneForm, title: event.target.value })} />
                      <input className="h-9 rounded-md border border-slate-200 px-3 text-sm" type="date" value={milestoneForm.dueDate} onChange={(event) => setMilestoneForm({ ...milestoneForm, dueDate: event.target.value })} />
                      <input className="h-9 rounded-md border border-slate-200 px-3 text-sm" min="0" step="0.01" type="number" placeholder={translate('contracts.billing.amount')} value={milestoneForm.amount} onChange={(event) => setMilestoneForm({ ...milestoneForm, amount: event.target.value })} />
                      <input className="h-9 rounded-md border border-slate-200 px-3 text-sm" max="100" min="0" step="0.01" type="number" placeholder="%" value={milestoneForm.percentage} onChange={(event) => setMilestoneForm({ ...milestoneForm, percentage: event.target.value })} />
                      <button className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-white disabled:opacity-60" disabled={milestoneMutation.isPending || !milestoneForm.title.trim() || (!milestoneForm.amount && !milestoneForm.percentage)} type="submit">{translate('common.create')}</button>
                    </form>
                  ) : null}
                  <CompactRows
                    empty={translate('contracts.billing.noMilestones')}
                    rows={(contract.milestones ?? []).map((milestone) => ({
                      id: milestone.id,
                      title: milestone.title,
                      meta: `${formatDate(milestone.dueDate)} - ${milestone.amount == null ? `${milestone.percentage ?? 0}%` : formatCurrency(Number(milestone.amount), contract.currency)}`,
                      value: translate(`contracts.billing.milestoneStatus.${milestone.status}`),
                      action: milestone.status !== 'APPROVED' && milestone.status !== 'INVOICED' && hasPermission('contracts.milestones.manage')
                        ? { label: translate('contracts.billing.approve'), onClick: () => approveMilestoneMutation.mutate(milestone.id), disabled: approveMilestoneMutation.isPending }
                        : canGenerateInvoice && milestone.status === 'APPROVED' && !milestone.invoiceId
                          ? { label: translate('contracts.actions.generateInvoice'), onClick: () => targetedInvoiceMutation.mutate({ milestoneId: milestone.id }), disabled: targetedInvoiceMutation.isPending }
                          : undefined,
                    }))}
                  />
                </div>
              ) : null}
              {['FIXED', 'CUSTOM'].includes(contract.pricingType) ? (
                <div className="rounded-lg border border-slate-200 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h4 className="font-semibold text-slate-950">{translate('contracts.billing.schedule')}</h4>
                    <span className="text-xs font-medium text-slate-500">{translate('contracts.billing.count', { count: contract.billingScheduleItems?.length ?? 0 })}</span>
                  </div>
                  {hasPermission('contracts.pricing.manage') ? (
                    <form className="mb-4 grid gap-2 rounded-lg bg-slate-50 p-3 md:grid-cols-[1.4fr_1fr_120px_auto]" onSubmit={(event) => { event.preventDefault(); scheduleMutation.mutate(); }}>
                      <input className="h-9 rounded-md border border-slate-200 px-3 text-sm" required placeholder={translate('contracts.billing.label')} value={scheduleForm.label} onChange={(event) => setScheduleForm({ ...scheduleForm, label: event.target.value })} />
                      <input className="h-9 rounded-md border border-slate-200 px-3 text-sm" required type="date" value={scheduleForm.dueDate} onChange={(event) => setScheduleForm({ ...scheduleForm, dueDate: event.target.value })} />
                      <input className="h-9 rounded-md border border-slate-200 px-3 text-sm" min="0.01" step="0.01" required type="number" placeholder={translate('contracts.billing.amount')} value={scheduleForm.amount} onChange={(event) => setScheduleForm({ ...scheduleForm, amount: event.target.value })} />
                      <button className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-white disabled:opacity-60" disabled={scheduleMutation.isPending || !scheduleForm.label.trim() || !scheduleForm.amount} type="submit">{translate('common.create')}</button>
                    </form>
                  ) : null}
                  <CompactRows
                    empty={translate('contracts.billing.noSchedule')}
                    rows={(contract.billingScheduleItems ?? []).map((item) => ({
                      id: item.id,
                      title: item.label,
                      meta: formatDate(item.dueDate),
                      value: `${formatCurrency(Number(item.amount), contract.currency)} - ${translate(`contracts.billing.scheduleStatus.${item.status}`)}`,
                      action: canGenerateInvoice && item.status !== 'INVOICED' && !item.invoiceId
                        ? { label: translate('contracts.actions.generateInvoice'), onClick: () => targetedInvoiceMutation.mutate({ scheduleItemId: item.id }), disabled: targetedInvoiceMutation.isPending }
                        : undefined,
                    }))}
                  />
                </div>
              ) : null}
              <div className="rounded-lg border border-slate-200 p-4">
                <h4 className="mb-3 font-semibold text-slate-950">{translate('contracts.fields.content')}</h4>
                <pre className="whitespace-pre-wrap text-sm text-slate-700">{contract.currentVersion?.content ?? '-'}</pre>
              </div>
              <div className="rounded-lg border border-slate-200 p-4">
                <h4 className="mb-3 font-semibold text-slate-950">{translate('contracts.audit')}</h4>
                <div className="space-y-3">
                  {(contract.auditLogs ?? []).map((event) => (
                    <div className="flex gap-3" key={event.id}>
                      <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
                      <div>
                        <p className="text-sm font-medium text-slate-900">{event.action}</p>
                        <p className="text-xs text-slate-500">{event.actor?.name ?? translate('contracts.publicSigner')} - {formatDateTime(event.createdAt)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 p-4">
                <h4 className="mb-3 font-semibold text-slate-950">{translate('contracts.email.history')}</h4>
                <div className="space-y-3">
                  {(contract.emailLogs ?? []).length ? (contract.emailLogs ?? []).map((log) => (
                    <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3 last:border-0 last:pb-0" key={log.id}>
                      <div>
                        <p className="text-sm font-medium text-slate-900">{log.recipientEmail}</p>
                        <p className="text-xs text-slate-500">{log.subject}</p>
                      </div>
                      <div className="text-right rtl:text-left">
                        <p className="text-xs font-semibold text-slate-700">{log.status}</p>
                        <p className="text-xs text-slate-500">{formatDateTime(log.createdAt)}</p>
                      </div>
                    </div>
                  )) : <p className="text-sm text-slate-500">{translate('contracts.email.empty')}</p>}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-semibold uppercase text-slate-500">{label}</p><p className="mt-1 break-all text-sm font-semibold text-slate-950">{value}</p></div>;
}

function SignatureBadge({ status, translate }: { status: NonNullable<Contract['currentVersion']>['signatureStatus']; translate: Translate }) {
  const tone: Record<typeof status, string> = {
    NOT_STARTED: 'bg-slate-100 text-slate-700',
    COMPANY_PENDING: 'bg-amber-100 text-amber-700',
    COMPANY_SIGNED: 'bg-blue-100 text-blue-700',
    CLIENT_PENDING: 'bg-violet-100 text-violet-700',
    CLIENT_SIGNED: 'bg-emerald-100 text-emerald-700',
    COMPLETED: 'bg-green-100 text-green-700',
    REVOKED: 'bg-rose-100 text-rose-700',
  };
  return <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${tone[status]}`}>{translate(`contracts.signature.status.${status}`)}</span>;
}

function formatContractAmount(contract: Contract) {
  const amount = contract.fixedAmount ?? contract.unitRate ?? contract.amount;
  return amount == null ? '-' : formatCurrency(Number(amount), contract.currency);
}

function formatContractPricing(contract: Contract, translate: Translate) {
  if (contract.pricingType === 'FIXED') {
    return contract.fixedAmount == null ? '-' : formatCurrency(Number(contract.fixedAmount), contract.currency);
  }
  if (isTimeEntryPricingType(contract.pricingType)) {
    return contract.unitRate == null
      ? '-'
      : `${formatCurrency(Number(contract.unitRate), contract.currency)} / ${translate(`contracts.pricing.units.${getTimeEntryUnitKey(contract.pricingType)}`)}`;
  }
  return translate(`contracts.pricing.types.${contract.pricingType}`);
}

function formatDate(value?: string | null) {
  return value ? new Intl.DateTimeFormat('fr-FR').format(new Date(value)) : '-';
}

function formatDateTime(value?: string | null) {
  return value ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '-';
}

function calculateDurationMinutes(startTime: string, endTime: string, breakMinutes: number) {
  if (!startTime || !endTime) return 0;
  const [startHour = 0, startMinute = 0] = startTime.split(':').map(Number);
  const [endHour = 0, endMinute = 0] = endTime.split(':').map(Number);
  const start = startHour * 60 + startMinute;
  let end = endHour * 60 + endMinute;
  if (end <= start) end += 24 * 60;
  return Math.max(0, end - start - Math.max(0, breakMinutes || 0));
}

function formatDuration(minutes: number) {
  if (!minutes) return '0h';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}min`;
  return rest ? `${hours}h ${rest}min` : `${hours}h`;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isTimeEntryPricingType(pricingType?: ContractPricingType | null) {
  return pricingType === 'HOURLY'
    || pricingType === 'DAILY'
    || pricingType === 'MONTHLY'
    || pricingType === 'MONTHLY_SUBSCRIPTION'
    || pricingType === 'ANNUAL_SUBSCRIPTION';
}

function getTimeEntryUnitKey(pricingType?: ContractPricingType | null) {
  if (pricingType === 'DAILY') return 'DAILY';
  if (pricingType === 'MONTHLY' || pricingType === 'MONTHLY_SUBSCRIPTION') return 'MONTHLY';
  if (pricingType === 'ANNUAL_SUBSCRIPTION') return 'ANNUAL_SUBSCRIPTION';
  return 'HOURLY';
}

function getTimeEntryUnitMinutes(pricingType?: ContractPricingType | null) {
  if (pricingType === 'DAILY') return 480;
  if (pricingType === 'MONTHLY' || pricingType === 'MONTHLY_SUBSCRIPTION') return 30 * 480;
  if (pricingType === 'ANNUAL_SUBSCRIPTION') return 365 * 480;
  return 60;
}

function formatBillingQuantity(quantity: number, unit: string) {
  const value = Number.isFinite(quantity) ? Math.round((quantity + Number.EPSILON) * 100) / 100 : 0;
  return `${value.toLocaleString('fr-FR')} ${unit}`;
}

function shortenId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function formatActivity(value: string | null | undefined, translate: Translate) {
  return value ? translate(`contracts.billing.activities.${value}`) : '-';
}

function getApprovedBillableTimePeriod(timeEntries: NonNullable<Contract['timeEntries']>): ContractBillingInvoiceInput {
  const dates = timeEntries
    .filter((entry) => entry.status === 'APPROVED' && entry.billable && !entry.invoiceId)
    .map((entry) => entry.workDate.slice(0, 10))
    .sort();

  if (!dates.length) return {};
  return {
    periodStart: dates[0],
    periodEnd: dates[dates.length - 1],
  };
}
