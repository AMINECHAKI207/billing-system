import { isValidElement, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, CheckCircle2, Copy, Download, Eye, FileJson, FileDown, KeyRound, LogIn, LogOut, Network, Pencil, Plus, Search, ShieldCheck, Trash2, UserCircle, X, XCircle } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { exportAuditLogs, getAuditLogs } from '@/lib/api';
import {
  buildAuditChangeRows,
  buildAuditSummaryRows,
  flattenAuditObject,
  formatAuditEntityLabel,
  formatAuditFieldLabel,
  formatAuditModuleLabel,
  formatAuditValue,
  getAuditPermissionSummary,
  isAuditEmptyValue,
  normalizeAuditBrowserName,
} from '@/lib/auditFormatters';
import { useToast } from '@/hooks/useToast';
import type { AuditLog, AuditLogFilters } from '@/types';

type Props = {
  getApiErrorMessage: (error: unknown, fallback: string) => string;
};

type PermissionModalState = {
  permissions: string[];
  usedPermission?: string;
};

const ACTION_OPTIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'LOGIN',
  'LOGOUT',
  'LOGIN_FAILED',
  'APPROVE',
  'REJECT',
  'EXPORT',
  'PDF_GENERATED',
  'EMAIL_SENT',
  'PASSWORD_CHANGED',
  'CONTRACT_SIGNED',
  'CREDIT_NOTE_CREATED',
  'EXPENSE_SUBMITTED',
];

const MODULE_OPTIONS = [
  'authentication',
  'users',
  'roles',
  'permissions',
  'clients',
  'invoices',
  'payments',
  'expense_notes',
  'credit_notes',
  'contracts',
  'devis',
  'reports',
  'settings',
  'notifications',
];

export function AuditLogsView({ getApiErrorMessage }: Props) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [module, setModule] = useState('');
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [success, setSuccess] = useState<'ALL' | 'true' | 'false'>('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [permissionsModal, setPermissionsModal] = useState<PermissionModalState | null>(null);
  const [exporting, setExporting] = useState<'csv' | 'excel' | 'pdf' | ''>('');
  const [copiedValue, setCopiedValue] = useState('');

  const filters = useMemo<AuditLogFilters>(() => ({
    page,
    limit: 25,
    search: search || undefined,
    module: module || undefined,
    entity: entity || undefined,
    action: action || undefined,
    success: success === 'ALL' ? undefined : success,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  }), [action, endDate, entity, module, page, search, startDate, success]);

  const auditLogsQuery = useQuery({
    queryKey: ['audit-logs', filters],
    queryFn: () => getAuditLogs(filters),
  });

  const logs = auditLogsQuery.data?.data ?? [];
  const meta = auditLogsQuery.data?.meta;

  useEffect(() => {
    if (!selectedLog) return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (permissionsModal) {
          setPermissionsModal(null);
          return;
        }
        setSelectedLog(null);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [permissionsModal, selectedLog]);

  const activeFilters = [
    search ? { key: 'search', label: t('auditLogs.searchChip', { value: search }), clear: () => setSearch('') } : null,
    module ? { key: 'module', label: module, clear: () => setModule('') } : null,
    entity ? { key: 'entity', label: entity, clear: () => setEntity('') } : null,
    action ? { key: 'action', label: action, clear: () => setAction('') } : null,
    success !== 'ALL' ? { key: 'success', label: success === 'true' ? t('auditLogs.success') : t('auditLogs.failure'), clear: () => setSuccess('ALL') } : null,
  ].filter((item): item is { key: string; label: string; clear: () => void } => Boolean(item));

  async function handleExport(format: 'csv' | 'excel' | 'pdf') {
    setExporting(format);
    try {
      await exportAuditLogs({ ...filters, format });
      toast.success(t('auditLogs.exportSuccess'));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('auditLogs.exportError')));
    } finally {
      setExporting('');
    }
  }

  function resetFilters() {
    setSearch('');
    setModule('');
    setEntity('');
    setAction('');
    setSuccess('ALL');
    setStartDate('');
    setEndDate('');
    setPage(1);
  }

  async function copyToClipboard(value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedValue(value);
    window.setTimeout(() => setCopiedValue(''), 1400);
  }

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 dark:border-slate-800 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-primary">
              <ShieldCheck className="h-4 w-4" />
              {t('auditLogs.eyebrow')}
            </div>
            <h2 className="mt-1 text-xl font-semibold text-slate-950 dark:text-slate-50">{t('auditLogs.title')}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('auditLogs.count', { count: meta?.total ?? 0 })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-900" disabled={Boolean(exporting)} onClick={() => handleExport('csv')} type="button">
              <Download className="h-4 w-4" /> CSV
            </button>
            <button className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-900" disabled={Boolean(exporting)} onClick={() => handleExport('excel')} type="button">
              <Download className="h-4 w-4" /> Excel
            </button>
            <button className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-900" disabled={Boolean(exporting)} onClick={() => handleExport('pdf')} type="button">
              <Download className="h-4 w-4" /> PDF
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
          <label className="relative min-w-[260px] flex-[1_1_320px]">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="h-10 w-full rounded-md border border-slate-200 bg-white px-9 text-sm outline-none ring-primary/20 transition focus:ring-4 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100" onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={t('auditLogs.search')} value={search} />
          </label>
          <select className="h-10 min-w-[180px] flex-[1_1_190px] rounded-md border border-slate-200 bg-white px-3 pe-9 text-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100" onChange={(event) => { setModule(event.target.value); setPage(1); }} value={module}>
            <option value="">{t('auditLogs.allModules')}</option>
            {MODULE_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <input className="h-10 min-w-[160px] flex-[1_1_170px] rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100" onChange={(event) => { setEntity(event.target.value); setPage(1); }} placeholder={t('auditLogs.entity')} value={entity} />
          <select className="h-10 min-w-[190px] flex-[1_1_210px] rounded-md border border-slate-200 bg-white px-3 pe-9 text-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100" onChange={(event) => { setAction(event.target.value); setPage(1); }} value={action}>
            <option value="">{t('auditLogs.allActions')}</option>
            {ACTION_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select className="h-10 min-w-[180px] flex-[1_1_190px] rounded-md border border-slate-200 bg-white px-3 pe-9 text-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100" onChange={(event) => { setSuccess(event.target.value as 'ALL' | 'true' | 'false'); setPage(1); }} value={success}>
            <option value="ALL">{t('auditLogs.allResults')}</option>
            <option value="true">{t('auditLogs.success')}</option>
            <option value="false">{t('auditLogs.failure')}</option>
          </select>
          <input className="h-10 min-w-[160px] flex-[0_1_170px] rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100" onChange={(event) => { setStartDate(event.target.value); setPage(1); }} title={t('auditLogs.startDate')} type="date" value={startDate} />
          <input className="h-10 min-w-[160px] flex-[0_1_170px] rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100" onChange={(event) => { setEndDate(event.target.value); setPage(1); }} title={t('auditLogs.endDate')} type="date" value={endDate} />
          <button className="h-10 min-w-[120px] flex-none rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-900" onClick={resetFilters} type="button">{t('common.reset')}</button>
        </div>

        {activeFilters.length ? (
          <div className="flex flex-wrap gap-2 border-b border-slate-200 px-4 py-2 dark:border-slate-800">
            {activeFilters.map((filter) => (
              <button className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700" key={filter.key} onClick={filter.clear} type="button">
                {filter.label}
                <X className="h-3 w-3" />
              </button>
            ))}
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3 font-semibold">{t('auditLogs.time')}</th>
                <th className="px-4 py-3 font-semibold">{t('auditLogs.user')}</th>
                <th className="px-4 py-3 font-semibold">{t('auditLogs.module')}</th>
                <th className="px-4 py-3 font-semibold">{t('auditLogs.entity')}</th>
                <th className="px-4 py-3 font-semibold">{t('auditLogs.action')}</th>
                <th className="px-4 py-3 font-semibold">{t('auditLogs.route')}</th>
                <th className="px-4 py-3 font-semibold">{t('auditLogs.device')}</th>
                <th className="px-4 py-3 font-semibold">{t('auditLogs.result')}</th>
                <th className="px-4 py-3 text-right font-semibold">{t('auditLogs.details')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {logs.map((log) => (
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-900/70" key={log.id}>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatDateTime(log.createdAt, i18n.language)}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900 dark:text-slate-100">{log.user?.name ?? t('auditLogs.system')}</p>
                    <p className="text-xs text-slate-500">{log.user?.email ?? '-'}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{formatAuditModuleLabel(log.module, t)}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900 dark:text-slate-100">{formatAuditEntityLabel(log.entity, t)}</p>
                    <p className="max-w-[180px] truncate text-xs text-slate-500" title={log.entityId ?? undefined}>{log.entityId ?? '-'}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">{log.action}</span>
                  </td>
                  <td className="max-w-[240px] truncate px-4 py-3 text-slate-500" title={log.route ?? undefined}>{log.httpMethod ?? ''} {log.route ?? '-'}</td>
                  <td className="px-4 py-3 text-slate-500">{[log.browser, log.operatingSystem, log.device].filter(Boolean).join(' / ') || '-'}</td>
                  <td className="px-4 py-3">
                    <AuditResultBadge success={log.success} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-900" onClick={() => setSelectedLog(log)} type="button">
                      <Eye className="h-4 w-4" />
                      {t('common.view')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!auditLogsQuery.isLoading && logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-10 text-center text-slate-500">
            <FileJson className="h-8 w-8" />
            <p className="font-medium">{t('auditLogs.empty')}</p>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 text-sm dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-slate-500">{t('auditLogs.pageSummary', { page: meta?.page ?? page, totalPages: meta?.totalPages ?? 1, total: meta?.total ?? 0 })}</p>
          <div className="flex gap-2">
            <button className="h-9 rounded-md border border-slate-200 px-3 font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-900" disabled={(meta?.page ?? page) <= 1 || auditLogsQuery.isFetching} onClick={() => setPage((current) => Math.max(1, current - 1))} type="button">{t('common.previous')}</button>
            <button className="h-9 rounded-md border border-slate-200 px-3 font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-900" disabled={(meta?.page ?? page) >= (meta?.totalPages ?? 1) || auditLogsQuery.isFetching} onClick={() => setPage((current) => current + 1)} type="button">{t('common.next')}</button>
          </div>
        </div>
      </div>

      {selectedLog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="audit-details-title">
          <div className="max-h-[88vh] w-full max-w-5xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800">
              <div>
                <h3 id="audit-details-title" className="flex flex-wrap items-center gap-2 text-lg font-semibold text-slate-950 dark:text-slate-50">
                  <AuditActionBadge action={selectedLog.action} />
                  <span className="min-w-0 break-words">{getAuditEntityTitle(selectedLog, t, i18n.language)}</span>
                </h3>
                <p className="text-sm text-slate-500">
                  {formatAuditModuleLabel(selectedLog.module, t)} / {formatAuditEntityLabel(selectedLog.entity, t)}
                </p>
              </div>
              <button ref={closeButtonRef} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900" onClick={() => setSelectedLog(null)} type="button" aria-label={t('common.close')}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[72vh] space-y-4 overflow-y-auto p-4">
              <AuditSummaryHeader log={selectedLog} />
              <AuditActorCard copiedValue={copiedValue} log={selectedLog} onCopy={copyToClipboard} />
              <AuditReadableValues log={selectedLog} />
              <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                <AuditInfoCard copiedValue={copiedValue} onCopy={copyToClipboard} title={t('auditLogs.generalInformation')} items={[
                  [t('auditLogs.module'), formatAuditModuleLabel(selectedLog.module, t)],
                  [t('auditLogs.entity'), formatAuditEntityLabel(selectedLog.entity, t)],
                  [t('auditLogs.entityId'), getAuditEntityDisplay(selectedLog, t, copiedValue, copyToClipboard)],
                  [t('auditLogs.action'), <AuditActionBadge key="action" action={selectedLog.action} />],
                  [t('auditLogs.result'), <AuditResultBadge key="result" success={selectedLog.success} />],
                  [t('auditLogs.timestamp'), <DateTimeValue key="timestamp" value={selectedLog.createdAt} />],
                ]} />
                <AuditInfoCard copiedValue={copiedValue} onCopy={copyToClipboard} title={t('auditLogs.requestContext')} items={[
                  [t('auditLogs.ipAddress'), selectedLog.ipAddress],
                  [t('auditLogs.browser'), normalizeAuditBrowserName(selectedLog.browser, selectedLog.userAgent)],
                  [t('auditLogs.operatingSystem'), selectedLog.operatingSystem],
                  [t('auditLogs.device'), selectedLog.device],
                  [t('auditLogs.route'), selectedLog.route ? <RouteValue key="route" method={selectedLog.httpMethod} route={selectedLog.route} /> : null],
                  [t('auditLogs.statusCode'), selectedLog.statusCode ? <AuditHttpStatusBadge key="status-code" statusCode={selectedLog.statusCode} /> : null],
                  [t('auditLogs.executionTime'), selectedLog.executionTime ? `${selectedLog.executionTime} ms` : null],
                  [t('auditLogs.requestId'), selectedLog.requestId ? <CopyableValue key="request-id" copied={copiedValue === selectedLog.requestId} label={t('auditLogs.copyRequestId')} mode="request" onCopy={() => copyToClipboard(selectedLog.requestId!)} value={selectedLog.requestId} /> : null],
                  [t('auditLogs.sessionId'), selectedLog.sessionId ? <CopyableValue key="session-id" copied={copiedValue === selectedLog.sessionId} label={t('auditLogs.copyValue')} mode="id" onCopy={() => copyToClipboard(selectedLog.sessionId!)} value={selectedLog.sessionId} /> : null],
                ]} />
                <AuditInfoCard copiedValue={copiedValue} onCopy={copyToClipboard} title={t('auditLogs.metadata')} items={[
                  ...permissionSummaryToItems(getAuditPermissionSummary(selectedLog), t, copiedValue, copyToClipboard, setPermissionsModal),
                  ...objectToInfoItems(selectedLog.metadata, t, i18n.language, selectedLog),
                ]} />
              </div>
              <details className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
                <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {t('auditLogs.advanced')} / {t('auditLogs.rawJson')}
                </summary>
                <div className="grid gap-4 border-t border-slate-200 p-4 dark:border-slate-800 lg:grid-cols-2">
                  <AuditDetailBlock title={t('auditLogs.oldValues')} value={selectedLog.oldValues ?? {}} />
                  <AuditDetailBlock title={t('auditLogs.newValues')} value={selectedLog.newValues ?? {}} />
                  <AuditDetailBlock title={t('auditLogs.metadata')} value={selectedLog.metadata ?? {}} />
                  <AuditDetailBlock title={t('auditLogs.context')} value={{
                    user: selectedLog.user,
                    ipAddress: selectedLog.ipAddress,
                    userAgent: selectedLog.userAgent,
                    browser: selectedLog.browser,
                    operatingSystem: selectedLog.operatingSystem,
                    device: selectedLog.device,
                    httpMethod: selectedLog.httpMethod,
                    route: selectedLog.route,
                    statusCode: selectedLog.statusCode,
                    success: selectedLog.success,
                    executionTime: selectedLog.executionTime,
                    requestId: selectedLog.requestId,
                    sessionId: selectedLog.sessionId,
                    createdAt: selectedLog.createdAt,
                  }} />
                </div>
              </details>
            </div>
          </div>
          {permissionsModal ? (
            <PermissionsModal
              copiedValue={copiedValue}
              onClose={() => setPermissionsModal(null)}
              onCopy={copyToClipboard}
              state={permissionsModal}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function AuditReadableValues({ log }: { log: AuditLog }) {
  const { t, i18n } = useTranslation();
  const isUpdate = log.action === 'UPDATE';
  const isDelete = log.action === 'DELETE';
  const title = isUpdate
    ? t('auditLogs.changes')
    : isDelete
      ? t('auditLogs.deletedData')
      : t('auditLogs.createdData');
  const changeRows = isUpdate ? buildAuditChangeRows(log, t, i18n.language) : [];
  const summaryRows = isUpdate ? [] : buildAuditSummaryRows(isDelete ? log.oldValues : log.newValues, t, i18n.language, log);

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h4>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {isUpdate ? t('auditLogs.changedFieldsCount', { count: changeRows.length }) : t('auditLogs.summaryFieldsCount', { count: summaryRows.length })}
        </p>
      </div>
      <div className="min-w-0">
        {isUpdate ? (
          <table className="w-full table-fixed text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="w-[28%] px-4 py-3 text-start font-semibold">{t('auditLogs.field')}</th>
                <th className="w-[36%] px-4 py-3 text-start font-semibold">{t('auditLogs.previousValue')}</th>
                <th className="w-[36%] px-4 py-3 text-start font-semibold">{t('auditLogs.newValue')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {changeRows.map((row) => (
                <tr key={row.path}>
                  <td className="min-w-0 px-4 py-3 font-medium text-slate-800 dark:text-slate-100"><span className="block truncate" title={row.label}>{row.label}</span></td>
                  <td className="min-w-0 px-4 py-3 text-slate-500 dark:text-slate-400"><span className="block truncate" title={row.formattedOldValue}>{row.formattedOldValue}</span></td>
                  <td className="min-w-0 px-4 py-3">
                    <span className="block max-w-full truncate rounded-md bg-emerald-50 px-2 py-1 font-semibold text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900" title={row.formattedNewValue}>
                      {row.formattedNewValue}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {summaryRows.map((row) => (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900" key={row.path}>
                <p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">{row.label}</p>
                <p className="mt-1 break-words text-sm font-medium text-slate-900 dark:text-slate-100">{row.formattedValue}</p>
              </div>
            ))}
          </div>
        )}
        {!(isUpdate ? changeRows.length : summaryRows.length) ? <p className="p-4 text-sm text-slate-500">{t('auditLogs.noReadableData')}</p> : null}
      </div>
    </section>
  );
}

function AuditSummaryHeader({ log }: { log: AuditLog }) {
  const { t, i18n } = useTranslation();
  const Icon = getActionIcon(log.action);
  const userName = log.user?.name ?? t('auditLogs.system');
  const entityTitle = getAuditEntityTitle(log, t, i18n.language);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <AuditActionBadge action={log.action} />
              <AuditResultBadge success={log.success} />
            </div>
            <h4 className="mt-2 break-words text-base font-semibold text-slate-950 dark:text-slate-50">{entityTitle}</h4>
            <p className="mt-1 break-words text-sm text-slate-500 dark:text-slate-400">
              {formatAuditModuleLabel(log.module, t)} / {formatAuditEntityLabel(log.entity, t)}
            </p>
          </div>
        </div>
        <div className="grid min-w-0 gap-2 text-sm sm:grid-cols-2 lg:min-w-[320px]">
          <div className="min-w-0 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">{t('auditLogs.user')}</p>
            <p className="truncate font-medium text-slate-900 dark:text-slate-100" title={userName}>{userName}</p>
          </div>
          <div className="min-w-0 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">{t('auditLogs.timestamp')}</p>
            <DateTimeValue value={log.createdAt} />
          </div>
        </div>
      </div>
    </section>
  );
}

function AuditActorCard({ copiedValue, log, onCopy }: { copiedValue: string; log: AuditLog; onCopy: (value: string) => void }) {
  const { t, i18n } = useTranslation();
  const user = log.user;
  const initials = user?.name
    ? user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
    : 'SYS';

  return (
    <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
            {user ? initials : <UserCircle className="h-6 w-6" />}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-950 dark:text-slate-50" title={user?.name ?? t('auditLogs.system')}>
              {user?.name ?? t('auditLogs.system')}
            </p>
            {user?.email ? (
              <CopyableValue copied={copiedValue === user.email} label={t('auditLogs.copyValue')} mode="email" onCopy={() => onCopy(user.email)} value={user.email} />
            ) : (
              <p className="text-xs text-slate-500">{t('auditLogs.systemAction')}</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {user?.role ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              {formatAuditValue(user.role, 'role', t, i18n.language, log)}
            </span>
          ) : null}
          <AuditActionBadge action={log.action} />
          <AuditResultBadge success={log.success} />
        </div>
      </div>
    </section>
  );
}

function AuditInfoCard({
  copiedValue,
  items,
  onCopy,
  title,
}: {
  copiedValue: string;
  items: Array<[string, ReactNode]>;
  onCopy: (value: string) => void;
  title: string;
}) {
  const visibleItems = items.filter(([, value]) => !isRenderableEmpty(value));
  return (
    <section className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
      <h4 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h4>
      <dl className="grid gap-2 text-sm">
        {visibleItems.length ? visibleItems.map(([label, value]) => (
          <div className="grid min-w-0 gap-1" key={label}>
            <dt className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">{label}</dt>
            <dd className="min-w-0">
              <div className="flex max-w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-800 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
                <SmartAuditValue copiedValue={copiedValue} onCopy={onCopy} value={value} />
              </div>
            </dd>
          </div>
        )) : <p className="text-sm text-slate-500">-</p>}
      </dl>
    </section>
  );
}

function AuditDetailBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
      <h4 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h4>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-white p-3 text-xs text-slate-700 dark:bg-slate-950 dark:text-slate-200">
        {JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}

function AuditResultBadge({ success }: { success: boolean }) {
  const { t } = useTranslation();
  const className = success
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
    : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${className}`}>
      {success ? t('auditLogs.success') : t('auditLogs.failure')}
    </span>
  );
}

function AuditActionBadge({ action }: { action: string }) {
  const { t, i18n } = useTranslation();
  const normalized = action.toUpperCase();
  const className = normalized.includes('DELETE') || normalized.includes('REJECT') || normalized.includes('FAILED')
    ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
    : normalized.includes('UPDATE') || normalized.includes('EXPORT') || normalized.includes('PDF') || normalized.includes('EMAIL')
      ? 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300'
      : normalized.includes('APPROVE') || normalized.includes('CREATE') || normalized.includes('LOGIN')
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
        : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300';

  return (
    <span className={`inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${className}`} title={action}>
      <span className="truncate">{formatAuditValue(action, 'action', t, i18n.language)}</span>
    </span>
  );
}

function AuditHttpStatusBadge({ statusCode }: { statusCode: number }) {
  const { t } = useTranslation();
  const variant = statusCode >= 200 && statusCode < 300 ? 'success' : statusCode >= 400 ? 'failure' : 'warning';
  const className = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
    failure: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
    warning: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  }[variant];
  const label = variant === 'success' ? t('auditLogs.success') : variant === 'failure' ? t('auditLogs.failure') : t('auditLogs.warning');

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${className}`}>
      {statusCode} · {label}
    </span>
  );
}

function SmartAuditValue({ copiedValue, onCopy, value }: { copiedValue: string; onCopy: (value: string) => void; value: ReactNode }) {
  const { t } = useTranslation();
  if (isValidElement(value)) return value;
  if (typeof value !== 'string') return <span className="min-w-0 break-words">{value}</span>;

  const mode = detectCopyableMode(value);
  if (mode) {
    return (
      <CopyableValue
        copied={copiedValue === value}
        label={t('auditLogs.copyValue')}
        mode={mode}
        onCopy={() => onCopy(value)}
        value={value}
      />
    );
  }

  return <span className="min-w-0 break-words" title={value}>{value}</span>;
}

function RouteValue({ method, route }: { method?: string | null; route: string }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-2">
      <Network className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      {method ? <HttpMethodBadge method={method} /> : null}
      <span className="min-w-0 truncate font-mono text-xs" title={route}>{route}</span>
    </span>
  );
}

function HttpMethodBadge({ method }: { method: string }) {
  const methodName = method.toUpperCase();
  const className = {
    GET: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300',
    POST: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
    PUT: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
    PATCH: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300',
    DELETE: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
  }[methodName] ?? 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300';

  return <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${className}`}>{methodName}</span>;
}

function CopyableValue({
  copied,
  label,
  mode = 'id',
  onCopy,
  value,
}: {
  copied: boolean;
  label: string;
  mode?: 'email' | 'id' | 'request' | 'uuid';
  onCopy: () => void;
  value: string;
}) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-2">
      <span className="min-w-0 max-w-[180px] truncate font-mono text-xs" title={value}>{formatCompactValue(value, mode)}</span>
      <button
        aria-label={label}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/30 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        onClick={onCopy}
        type="button"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </span>
  );
}

function permissionSummaryToItems(
  summary: ReturnType<typeof getAuditPermissionSummary>,
  t: TFunction,
  copiedValue: string,
  onCopy: (value: string) => void,
  onOpenPermissions: (state: PermissionModalState) => void
): Array<[string, ReactNode]> {
  if (!summary) return [];
  const items: Array<[string, ReactNode]> = [[
    t('auditLogs.permissions'),
    <PermissionSummary key="permission-summary" copiedValue={copiedValue} onCopy={onCopy} onOpenPermissions={onOpenPermissions} summary={summary} />,
  ]];
  return items.filter(([, value]) => !isRenderableEmpty(value));
}

function PermissionSummary({
  copiedValue,
  onCopy,
  onOpenPermissions,
  summary,
}: {
  copiedValue: string;
  onCopy: (value: string) => void;
  onOpenPermissions: (state: PermissionModalState) => void;
  summary: NonNullable<ReturnType<typeof getAuditPermissionSummary>>;
}) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex min-w-0 flex-col gap-2">
        <span className="inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300">
          <KeyRound className="h-3 w-3" />
          {t('auditLogs.permissionCount', { count: summary.count })}
        </span>
        {summary.usedPermission ? (
          <span className="grid min-w-0 gap-1">
            <span className="text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">{t('auditLogs.usedPermission')}</span>
            <CopyableValue copied={copiedValue === summary.usedPermission} label={t('auditLogs.copyValue')} mode="id" onCopy={() => onCopy(summary.usedPermission!)} value={summary.usedPermission} />
          </span>
        ) : null}
      </div>
      {summary.permissions.length ? (
        <button
          className="inline-flex h-8 w-fit items-center whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-primary transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-900"
          onClick={() => onOpenPermissions({ permissions: summary.permissions, usedPermission: summary.usedPermission })}
          type="button"
        >
          {t('auditLogs.viewPermissions')}
        </button>
      ) : null}
    </div>
  );
}

function PermissionsModal({
  copiedValue,
  onClose,
  onCopy,
  state,
}: {
  copiedValue: string;
  onClose: () => void;
  onCopy: (value: string) => void;
  state: PermissionModalState;
}) {
  const { t } = useTranslation();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const groupedPermissions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = state.permissions
      .filter((permission) => !normalizedQuery || permission.toLowerCase().includes(normalizedQuery))
      .sort((a, b) => a.localeCompare(b));

    return filtered.reduce<Record<string, string[]>>((groups, permission) => {
      const moduleName = permission.split('.')[0] || t('auditLogs.otherPermissions');
      groups[moduleName] = [...(groups[moduleName] ?? []), permission];
      return groups;
    }, {});
  }, [query, state.permissions, t]);

  const visibleCount = Object.values(groupedPermissions).reduce((count, permissions) => count + permissions.length, 0);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="audit-permissions-title">
      <div className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <div className="min-w-0">
            <h3 id="audit-permissions-title" className="text-base font-semibold text-slate-950 dark:text-slate-50">{t('auditLogs.allPermissionsTitle')}</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('auditLogs.permissionCount', { count: state.permissions.length })}</p>
          </div>
          <button ref={closeRef} className="rounded-md p-2 text-slate-500 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-primary/30 dark:hover:bg-slate-900" onClick={onClose} type="button" aria-label={t('common.close')}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="border-b border-slate-200 p-4 dark:border-slate-800">
          {state.usedPermission ? (
            <div className="mb-3 rounded-md border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-800 dark:bg-indigo-950/30">
              <p className="text-xs font-semibold uppercase text-indigo-700 dark:text-indigo-300">{t('auditLogs.usedPermission')}</p>
              <div className="mt-1">
                <CopyableValue copied={copiedValue === state.usedPermission} label={t('auditLogs.copyValue')} mode="id" onCopy={() => onCopy(state.usedPermission!)} value={state.usedPermission} />
              </div>
            </div>
          ) : null}
          <label className="relative block">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-9 text-sm outline-none ring-primary/20 transition focus:ring-4 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('auditLogs.searchPermissions')}
              value={query}
            />
          </label>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('auditLogs.permissionSearchCount', { count: visibleCount })}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {Object.entries(groupedPermissions).length ? (
            <div className="space-y-4">
              {Object.entries(groupedPermissions).map(([moduleName, permissions]) => (
                <section className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900" key={moduleName}>
                  <div className="border-b border-slate-200 px-3 py-2 dark:border-slate-800">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{formatPermissionModule(moduleName)}</h4>
                  </div>
                  <div className="grid gap-1 p-2 sm:grid-cols-2">
                    {permissions.map((permission) => (
                      <div className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-white px-2 py-1.5 text-sm dark:bg-slate-950" key={permission}>
                        <span className="min-w-0 truncate font-mono text-xs text-slate-700 dark:text-slate-200" title={permission}>{permission}</span>
                        <button
                          aria-label={t('auditLogs.copyValue')}
                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/30 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                          onClick={() => onCopy(permission)}
                          type="button"
                        >
                          {copiedValue === permission ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <p className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">{t('auditLogs.noPermissionsFound')}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function isRenderableEmpty(value: ReactNode): boolean {
  if (value === null || value === undefined || typeof value === 'boolean') return true;
  if (typeof value === 'string') return isAuditEmptyValue(value) || value.trim() === '\u2014';
  if (typeof value === 'number') return false;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function detectCopyableMode(value: string): 'email' | 'id' | 'request' | 'uuid' | null {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'email';
  if (/^audit-[a-z0-9-]{8,}/i.test(value)) return 'request';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return 'uuid';
  if (/^[a-z0-9_-]{24,}$/i.test(value)) return 'id';
  return null;
}

function formatCompactValue(value: string, mode: 'email' | 'id' | 'request' | 'uuid'): string {
  if (mode === 'email') return compactEmail(value);
  if (mode === 'request') return value.length > 18 ? `${value.slice(0, 14)}...` : value;
  if (mode === 'uuid') return `${value.slice(0, 8)}...${value.slice(-4)}`;
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

function compactEmail(value: string): string {
  const [localPart, domain] = value.split('@');
  if (!localPart || !domain || localPart.length <= 16) return value;
  return `${localPart.slice(0, 16)}...@${domain}`;
}

function DateTimeValue({ value }: { value: string }) {
  const { i18n } = useTranslation();
  return (
    <span className="block min-w-0 text-sm font-medium text-slate-900 dark:text-slate-100">
      <span className="block">{formatDateOnly(value, i18n.language)}</span>
      <span className="block text-xs text-slate-500 dark:text-slate-400">{formatTimeOnly(value, i18n.language)}</span>
    </span>
  );
}

function getActionIcon(action: string) {
  const normalized = action.toUpperCase();
  if (normalized.includes('CREATE')) return Plus;
  if (normalized.includes('UPDATE')) return Pencil;
  if (normalized.includes('DELETE')) return Trash2;
  if (normalized.includes('LOGIN')) return LogIn;
  if (normalized.includes('LOGOUT')) return LogOut;
  if (normalized.includes('APPROVE')) return CheckCircle2;
  if (normalized.includes('REJECT') || normalized.includes('FAILED')) return XCircle;
  if (normalized.includes('EXPORT') || normalized.includes('PDF')) return FileDown;
  return ShieldCheck;
}

function formatPermissionModule(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getAuditEntityTitle(log: AuditLog, t: TFunction, language: string): string {
  const readable = getReadableEntityIdentifier(log);
  const entity = formatAuditEntityLabel(log.entity, t);
  const action = formatAuditValue(log.action, 'action', t, language, log);
  return readable ? `${action} - ${entity} ${readable}` : `${action} - ${entity}`;
}

function getAuditEntityDisplay(
  log: AuditLog,
  t: TFunction,
  copiedValue: string,
  onCopy: (value: string) => void
): ReactNode {
  const readable = getReadableEntityIdentifier(log);
  if (readable) return readable;
  if (!log.entityId) return null;
  return (
    <CopyableValue
      copied={copiedValue === log.entityId}
      label={t('auditLogs.copyValue')}
      mode={detectCopyableMode(log.entityId) ?? 'id'}
      onCopy={() => onCopy(log.entityId!)}
      value={log.entityId}
    />
  );
}

function getReadableEntityIdentifier(log: AuditLog): string | undefined {
  const flat = { ...flattenAuditObject(log.oldValues), ...flattenAuditObject(log.newValues) };
  const candidateKeys = [
    'invoiceNumber',
    'creditNoteNumber',
    'contractNumber',
    'devisNumber',
    'expenseNumber',
    'number',
    'reference',
    'documentNumber',
    'name',
    'company',
    'customer.name',
    'customer.company',
    'client.name',
    'client.company',
    'user.name',
    'createdBy.name',
  ];
  return candidateKeys
    .map((key) => flat[key])
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function formatDateTime(value: string, language?: string) {
  return new Intl.DateTimeFormat(language, {
    dateStyle: 'long',
    timeStyle: 'medium',
  }).format(new Date(value));
}

function formatDateOnly(value: string, language?: string) {
  return new Intl.DateTimeFormat(language, {
    dateStyle: 'long',
  }).format(new Date(value));
}

function formatTimeOnly(value: string, language?: string) {
  return new Intl.DateTimeFormat(language, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function objectToInfoItems(
  value: Record<string, unknown> | null | undefined,
  t: TFunction,
  language: string,
  log: AuditLog
): Array<[string, ReactNode]> {
  return Object.entries(flattenAuditObject(value))
    .filter(([key]) => !['permissions', 'permissionScopes'].some((hiddenKey) => key.toLowerCase().startsWith(hiddenKey.toLowerCase())))
    .map(([key, item]) => [formatAuditFieldLabel(key, t), formatAuditValue(item, key, t, language, log)] as [string, ReactNode])
    .filter(([, item]) => !isRenderableEmpty(item));
}
