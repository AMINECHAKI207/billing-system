import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Mail, Plus, Printer, RefreshCcw, Search, ShieldCheck, Trash2, Undo2 } from 'lucide-react';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/hooks/useConfirm';
import { useToast } from '@/hooks/useToast';
import {
  cancelCreditNote,
  createCreditNote,
  createCreditNoteReason,
  deleteCreditNote,
  getCreditNoteReasons,
  downloadCreditNotePdf,
  getCreditNotes,
  getInvoices,
  printCreditNotePdf,
  refundCreditNote,
  sendCreditNoteEmail,
  updateCreditNoteReason,
  validateCreditNote,
} from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import type { CreditNote, CreditNoteStatus, Invoice } from '@/types';

type Props = {
  hasPermission: (permission: string) => boolean;
  getApiErrorMessage: (error: unknown, fallback: string) => string;
  onOpenInvoice: (invoiceId: string) => void;
};

const statusClasses: Record<CreditNoteStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  VALIDATED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-rose-100 text-rose-700',
  REFUNDED: 'bg-purple-100 text-purple-700',
};

export function CreditNotesView({ hasPermission, getApiErrorMessage, onOpenInvoice }: Props) {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<CreditNoteStatus | 'ALL'>('ALL');
  const [isCreating, setIsCreating] = useState(false);
  const [invoiceId, setInvoiceId] = useState('');
  const [creditType, setCreditType] = useState<'PARTIAL' | 'FULL'>('PARTIAL');
  const [amountTTC, setAmountTTC] = useState('');
  const [reasonId, setReasonId] = useState('');
  const [reason, setReason] = useState('');
  const [newReasonCode, setNewReasonCode] = useState('');
  const [newReasonNameFr, setNewReasonNameFr] = useState('');
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const language = (i18n.resolvedLanguage || i18n.language || 'fr').startsWith('ar')
    ? 'ar'
    : (i18n.resolvedLanguage || i18n.language || 'fr').startsWith('en')
      ? 'en'
      : 'fr';

  const creditNotesQuery = useQuery({
    queryKey: ['credit-notes', search, status],
    queryFn: () => getCreditNotes({
      page: 1,
      limit: 50,
      search: search || undefined,
      status: status === 'ALL' ? undefined : status,
    }),
  });

  const invoicesQuery = useQuery({
    queryKey: ['credit-notes', 'invoices'],
    queryFn: () => getInvoices({ page: 1, limit: 100, sortBy: 'createdAt', sortOrder: 'desc' }),
    enabled: isCreating,
  });
  const reasonsQuery = useQuery({
    queryKey: ['credit-note-reasons', hasPermission('credit_note_reasons.manage')],
    queryFn: () => getCreditNoteReasons(hasPermission('credit_note_reasons.manage')),
  });

  const eligibleInvoices = useMemo(
    () => (invoicesQuery.data?.data ?? []).filter((invoice) => invoice.status !== 'DRAFT' && invoice.status !== 'CANCELLED'),
    [invoicesQuery.data]
  );
  const selectedInvoice = eligibleInvoices.find((invoice) => invoice.id === invoiceId);
  const creditNotes = creditNotesQuery.data?.data ?? [];
  const totalCreditNotes = creditNotesQuery.data?.meta?.total ?? creditNotes.length;
  const reasons = reasonsQuery.data ?? [];
  const activeReasons = reasons.filter((item) => item.isActive);
  const selectedReason = reasons.find((item) => item.id === reasonId);
  const reasonRequiresComment = selectedReason?.code === 'OTHER' || selectedReason?.requiresComment === true;

  const createMutation = useMutation({
    mutationFn: () => createCreditNote({
      invoiceId,
      type: creditType,
      issueDate,
      reasonId,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
      ...(creditType === 'PARTIAL' ? { amountTTC: Number(amountTTC) } : {}),
    }),
    onSuccess: (creditNote) => {
      toast.success(t('creditNotes.messages.created', { number: creditNote.creditNoteNumber }));
      setIsCreating(false);
      setInvoiceId('');
      setReason('');
      setReasonId('');
      setAmountTTC('');
      queryClient.invalidateQueries({ queryKey: ['credit-notes'] });
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('creditNotes.messages.createFailed'))),
  });

  const createReasonMutation = useMutation({
    mutationFn: () => createCreditNoteReason({
      code: newReasonCode.trim().toUpperCase(),
      nameFr: newReasonNameFr.trim(),
      nameEn: newReasonNameFr.trim(),
      nameAr: newReasonNameFr.trim(),
      category: 'CUSTOM',
      requiresComment: true,
      sortOrder: 500,
    }),
    onSuccess: () => {
      toast.success(t('creditNotes.messages.reasonSaved'));
      setNewReasonCode('');
      setNewReasonNameFr('');
      queryClient.invalidateQueries({ queryKey: ['credit-note-reasons'] });
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('creditNotes.messages.reasonSaveFailed'))),
  });

  const toggleReasonMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => updateCreditNoteReason(id, { isActive }),
    onSuccess: () => {
      toast.success(t('creditNotes.messages.reasonSaved'));
      queryClient.invalidateQueries({ queryKey: ['credit-note-reasons'] });
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('creditNotes.messages.reasonSaveFailed'))),
  });

  const actionMutation = useMutation({
    mutationFn: async ({ creditNote, action }: { creditNote: CreditNote; action: 'validate' | 'cancel' | 'refund' | 'delete' | 'download' | 'print' | 'email' }) => {
      if (action === 'validate') return validateCreditNote(creditNote.id);
      if (action === 'cancel') return cancelCreditNote(creditNote.id, t('creditNotes.defaultCancelReason'));
      if (action === 'refund') return refundCreditNote(creditNote.id, creditNote.invoiceCreditSummary?.refundableAmount || Number(creditNote.total), new Date().toISOString().slice(0, 10));
      if (action === 'delete') {
        await deleteCreditNote(creditNote.id);
        return null;
      }
      if (action === 'download') {
        await downloadCreditNotePdf(creditNote.id, creditNote.creditNoteNumber, language);
        return creditNote;
      }
      if (action === 'print') {
        await printCreditNotePdf(creditNote.id, language);
        return creditNote;
      }
      await sendCreditNoteEmail(creditNote.id, { pdfLanguage: language });
      return creditNote;
    },
    onSuccess: (_, variables) => {
      toast.success(t(`creditNotes.messages.${variables.action}`));
      queryClient.invalidateQueries({ queryKey: ['credit-notes'] });
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('creditNotes.messages.actionFailed'))),
  });

  const handleCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!invoiceId || !reasonId) {
      toast.warning(t('creditNotes.messages.required'));
      return;
    }
    if (reasonRequiresComment && !reason.trim()) {
      toast.warning(t('creditNotes.messages.reasonExplanationRequired'));
      return;
    }
    if (creditType === 'PARTIAL' && Number(amountTTC) <= 0) {
      toast.warning(t('creditNotes.messages.amountRequired'));
      return;
    }
    createMutation.mutate();
  };

  const handleAction = async (creditNote: CreditNote, action: 'validate' | 'cancel' | 'refund' | 'delete' | 'download' | 'print' | 'email') => {
    if (['validate', 'cancel', 'refund', 'delete'].includes(action)) {
      const accepted = await confirm({
        title: t(`creditNotes.confirm.${action}`, { number: creditNote.creditNoteNumber }),
        confirmText: t(action === 'delete' ? 'common.delete' : 'common.confirm'),
        cancelText: t('common.cancel'),
        variant: action === 'delete' || action === 'cancel' ? 'danger' : 'warning',
      });
      if (!accepted) return;
    }
    actionMutation.mutate({ creditNote, action });
  };

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{t('creditNotes.title')}</h2>
            <p className="text-sm text-slate-500">{t('creditNotes.count', { count: totalCreditNotes })}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                className="h-9 w-64 rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('creditNotes.search')}
                type="search"
                value={search}
              />
            </div>
            <select className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm" onChange={(event) => setStatus(event.target.value as CreditNoteStatus | 'ALL')} value={status}>
              <option value="ALL">{t('creditNotes.filters.all')}</option>
              {(['DRAFT', 'VALIDATED', 'CANCELLED', 'REFUNDED'] as CreditNoteStatus[]).map((item) => (
                <option key={item} value={item}>{t(`creditNotes.status.${item}`)}</option>
              ))}
            </select>
            {hasPermission('credit_notes.create') ? (
              <button className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white shadow-sm transition hover:bg-primary/90" onClick={() => setIsCreating(true)} type="button">
                <Plus className="h-4 w-4" />
                {t('creditNotes.create')}
              </button>
            ) : null}
          </div>
        </div>

        {isCreating ? (
          <form className="grid gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 lg:grid-cols-5" onSubmit={handleCreate}>
            <select className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm lg:col-span-2" onChange={(event) => setInvoiceId(event.target.value)} value={invoiceId}>
              <option value="">{t('creditNotes.form.invoice')}</option>
              {eligibleInvoices.map((invoice: Invoice) => (
                <option key={invoice.id} value={invoice.id}>
                  {invoice.invoiceNumber} - {invoice.customer?.company ?? invoice.customer?.name ?? ''} - {formatCurrency(Number(invoice.total), invoice.currency)}
                </option>
              ))}
            </select>
            <select className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm lg:col-span-2" disabled={reasonsQuery.isLoading || activeReasons.length === 0} onChange={(event) => setReasonId(event.target.value)} required value={reasonId}>
              <option value="">{reasonsQuery.isLoading ? t('common.loading') : t('creditNotes.form.reasonType')}</option>
              {activeReasons.map((item) => (
                <option key={item.id} value={item.id}>
                  {reasonLabel(item, language)}{item.requiresComment ? ' *' : ''}
                </option>
              ))}
            </select>
            <select className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm" onChange={(event) => setCreditType(event.target.value as 'PARTIAL' | 'FULL')} value={creditType}>
              <option value="PARTIAL">{t('creditNotes.type.PARTIAL')}</option>
              <option value="FULL">{t('creditNotes.type.FULL')}</option>
            </select>
            <input className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm" onChange={(event) => setIssueDate(event.target.value)} type="date" value={issueDate} />
            <input className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm" disabled={creditType === 'FULL'} min="0" onChange={(event) => setAmountTTC(event.target.value)} placeholder={t('creditNotes.form.amount')} type="number" value={creditType === 'FULL' && selectedInvoice ? String(selectedInvoice.total) : amountTTC} />
            <label className="flex flex-col gap-1 lg:col-span-4">
              <span className="text-xs font-medium text-slate-600">
                {reasonRequiresComment ? t('creditNotes.form.requiredExplanation') : t('creditNotes.form.optionalComment')}
              </span>
              <input
                className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                onChange={(event) => setReason(event.target.value)}
                placeholder={reasonRequiresComment ? t('creditNotes.form.requiredExplanation') : t('creditNotes.form.optionalComment')}
                required={reasonRequiresComment}
                value={reason}
              />
            </label>
            <div className="flex gap-2">
              <button className="h-10 rounded-md bg-primary px-3 text-sm font-medium text-white disabled:opacity-60" disabled={createMutation.isPending || activeReasons.length === 0} type="submit">{t('common.save')}</button>
              <button className="h-10 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700" onClick={() => setIsCreating(false)} type="button">{t('common.cancel')}</button>
            </div>
            {!reasonsQuery.isLoading && activeReasons.length === 0 ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 lg:col-span-5">
                {t('creditNotes.reasons.emptyActive')}
              </p>
            ) : null}
          </form>
        ) : null}

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-3 text-left">{t('creditNotes.table.number')}</th>
                <th className="px-5 py-3 text-left">{t('creditNotes.table.invoice')}</th>
                <th className="px-5 py-3 text-left">{t('creditNotes.table.client')}</th>
                <th className="px-5 py-3 text-left">{t('creditNotes.table.date')}</th>
                <th className="px-5 py-3 text-right">{t('creditNotes.table.total')}</th>
                <th className="px-5 py-3 text-left">{t('creditNotes.table.status')}</th>
                <th className="px-5 py-3 text-right">{t('creditNotes.table.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {creditNotes.map((creditNote) => (
                <tr className="hover:bg-slate-50" key={creditNote.id}>
                  <td className="px-5 py-3 font-semibold text-slate-900">{creditNote.creditNoteNumber}</td>
                  <td className="px-5 py-3">
                    {creditNote.invoice?.id ? (
                      <button className="font-medium text-primary transition hover:underline" onClick={() => onOpenInvoice(creditNote.invoice.id)} type="button">
                        {creditNote.invoice.invoiceNumber}
                      </button>
                    ) : (
                      <span className="text-slate-500">-</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-700">{creditNote.customer?.company ?? creditNote.customer?.name ?? '-'}</td>
                  <td className="px-5 py-3 text-slate-600">{new Intl.DateTimeFormat(language === 'ar' ? 'ar-MA' : 'fr-MA').format(new Date(creditNote.issueDate))}</td>
                  <td className="px-5 py-3 text-right font-semibold text-slate-900">{formatCurrency(Number(creditNote.total), creditNote.currency)}</td>
                  <td className="px-5 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusClasses[creditNote.status]}`}>{t(`creditNotes.status.${creditNote.status}`)}</span></td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-1">
                      {creditNote.status === 'DRAFT' && hasPermission('credit_notes.validate') ? <IconAction icon={<ShieldCheck className="h-4 w-4" />} label={t('creditNotes.actions.validate')} onClick={() => handleAction(creditNote, 'validate')} /> : null}
                      {creditNote.status === 'DRAFT' && hasPermission('credit_notes.update') ? <IconAction icon={<Trash2 className="h-4 w-4" />} label={t('common.delete')} onClick={() => handleAction(creditNote, 'delete')} /> : null}
                      {creditNote.status === 'VALIDATED' && hasPermission('credit_notes.refund') ? <IconAction icon={<Undo2 className="h-4 w-4" />} label={t('creditNotes.actions.refund')} onClick={() => handleAction(creditNote, 'refund')} /> : null}
                      {creditNote.status !== 'CANCELLED' && hasPermission('credit_notes.cancel') ? <IconAction icon={<RefreshCcw className="h-4 w-4" />} label={t('creditNotes.actions.cancel')} onClick={() => handleAction(creditNote, 'cancel')} /> : null}
                      {hasPermission('credit_notes.pdf.download') ? <IconAction icon={<Download className="h-4 w-4" />} label={t('creditNotes.actions.download')} onClick={() => handleAction(creditNote, 'download')} /> : null}
                      {hasPermission('credit_notes.pdf.download') ? <IconAction icon={<Printer className="h-4 w-4" />} label={t('creditNotes.actions.print')} onClick={() => handleAction(creditNote, 'print')} /> : null}
                      {hasPermission('credit_notes.email.send') ? <IconAction icon={<Mail className="h-4 w-4" />} label={t('creditNotes.actions.email')} onClick={() => handleAction(creditNote, 'email')} /> : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!creditNotesQuery.isLoading && !creditNotesQuery.isError && !creditNotes.length ? (
                <tr>
                  <td className="px-5 py-10 text-center text-slate-500" colSpan={7}>{t('creditNotes.empty')}</td>
                </tr>
              ) : null}
              {creditNotesQuery.isError ? (
                <tr>
                  <td className="px-5 py-10 text-center text-rose-600" colSpan={7}>{getApiErrorMessage(creditNotesQuery.error, t('creditNotes.messages.loadFailed'))}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      {hasPermission('credit_note_reasons.manage') ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">{t('creditNotes.reasons.title')}</h3>
              <p className="text-xs text-slate-500">{t('creditNotes.reasons.description')}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[160px_220px_auto]">
              <input className="h-9 rounded-md border border-slate-200 px-3 text-sm" onChange={(event) => setNewReasonCode(event.target.value)} placeholder={t('creditNotes.reasons.code')} value={newReasonCode} />
              <input className="h-9 rounded-md border border-slate-200 px-3 text-sm" onChange={(event) => setNewReasonNameFr(event.target.value)} placeholder={t('creditNotes.reasons.name')} value={newReasonNameFr} />
              <button className="h-9 rounded-md bg-slate-900 px-3 text-sm font-medium text-white disabled:opacity-60" disabled={!newReasonCode.trim() || !newReasonNameFr.trim() || createReasonMutation.isPending} onClick={() => createReasonMutation.mutate()} type="button">
                {t('common.create')}
              </button>
            </div>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {reasons.map((item) => (
              <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm" key={item.id}>
                <div>
                  <p className="font-medium text-slate-900">{reasonLabel(item, language)}</p>
                  <p className="text-xs text-slate-500">{item.code} - {t('creditNotes.reasons.usage', { count: item._count?.creditNotes ?? 0 })}</p>
                </div>
                <button className={`rounded-full px-2 py-1 text-xs font-semibold ${item.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`} disabled={toggleReasonMutation.isPending} onClick={() => toggleReasonMutation.mutate({ id: item.id, isActive: !item.isActive })} type="button">
                  {item.isActive ? t('creditNotes.reasons.active') : t('creditNotes.reasons.inactive')}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function reasonLabel(reason: { nameFr: string; nameEn: string; nameAr: string }, language: string) {
  if (language === 'ar') return reason.nameAr;
  if (language === 'en') return reason.nameEn;
  return reason.nameFr;
}

function IconAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button aria-label={label} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition hover:bg-slate-100" onClick={onClick} title={label} type="button">
      {icon}
    </button>
  );
}
