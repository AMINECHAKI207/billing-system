import type { TFunction } from 'i18next';
import type { AuditLog } from '@/types';

type FlatValues = Record<string, unknown>;

export type AuditChangeRow = {
  path: string;
  label: string;
  oldValue: unknown;
  newValue: unknown;
  formattedOldValue: string;
  formattedNewValue: string;
};

export type AuditSummaryRow = {
  path: string;
  label: string;
  value: unknown;
  formattedValue: string;
};

export type AuditPermissionSummary = {
  count: number;
  permissions: string[];
  usedPermission?: string;
};

const EMPTY_MARK = '\u2014';

const FIELD_FALLBACKS: Record<string, string> = {
  id: 'ID',
  userId: 'User',
  createdById: 'Created By',
  created_by: 'Created By',
  createdBy: 'Created By',
  updatedById: 'Updated By',
  customerId: 'Client',
  customer_id: 'Client',
  clientId: 'Client',
  client_id: 'Client',
  invoiceId: 'Invoice',
  invoice_id: 'Invoice',
  invoiceNumber: 'Invoice Number',
  creditNoteNumber: 'Credit Note Number',
  contractNumber: 'Contract Number',
  devisNumber: 'Quote Number',
  nextNumber: 'Next Number',
  next_number: 'Next Number',
  status: 'Status',
  role: 'Role',
  email: 'Email',
  name: 'Name',
  total: 'Total Amount',
  subtotal: 'Subtotal',
  taxAmount: 'Tax Amount',
  taxRate: 'Tax Rate',
  amount: 'Amount',
  amountPaid: 'Amount Paid',
  balanceDue: 'Balance Due',
  currency: 'Currency',
  issueDate: 'Issue Date',
  dueDate: 'Due Date',
  createdAt: 'Created At',
  updatedAt: 'Updated At',
};

const ENTITY_NAME_PATHS = [
  'name',
  'company',
  'email',
  'invoiceNumber',
  'creditNoteNumber',
  'contractNumber',
  'devisNumber',
  'expenseNumber',
  'reference',
  'title',
];

export function buildAuditChangeRows(log: AuditLog, t: TFunction, language: string): AuditChangeRow[] {
  const oldFlat = flattenAuditObject(log.oldValues);
  const newFlat = flattenAuditObject(log.newValues);
  return Array.from(new Set([...Object.keys(oldFlat), ...Object.keys(newFlat)]))
    .sort()
    .map((path) => {
      const oldValue = oldFlat[path];
      const newValue = newFlat[path];
      return {
        path,
        label: formatAuditFieldLabel(path, t),
        oldValue,
        newValue,
        formattedOldValue: formatAuditValue(oldValue, path, t, language, log),
        formattedNewValue: formatAuditValue(newValue, path, t, language, log),
      };
    })
    .filter((row) => row.formattedOldValue !== row.formattedNewValue)
    .filter((row) => !isAuditEmptyDisplay(row.formattedOldValue) || !isAuditEmptyDisplay(row.formattedNewValue));
}

export function buildAuditSummaryRows(
  values: Record<string, unknown> | null | undefined,
  t: TFunction,
  language: string,
  log: AuditLog
): AuditSummaryRow[] {
  return Object.entries(flattenAuditObject(values))
    .map(([path, value]) => ({
      path,
      label: formatAuditFieldLabel(path, t),
      value,
      formattedValue: formatAuditValue(value, path, t, language, log),
    }))
    .filter((row) => !isAuditEmptyValue(row.value) && !isAuditEmptyDisplay(row.formattedValue))
    .sort((a, b) => auditFieldWeight(a.path) - auditFieldWeight(b.path) || a.label.localeCompare(b.label));
}

export function formatAuditFieldLabel(path: string, t: TFunction): string {
  const translationKey = `auditLogs.fields.${path}`;
  const translated = t(translationKey, { defaultValue: '' });
  if (isResolvedTranslation(translated, translationKey)) return translated;

  const normalizedPath = path.replace(/\[(\d+)\]/g, '.$1');
  const parts = normalizedPath.split('.').filter(Boolean);
  const last = parts.at(-1) ?? path;
  const parent = parts.length > 1 ? parts.at(-2) : undefined;

  if (parent && ['id', 'name', 'email', 'company', 'title', 'invoiceNumber', 'contractNumber', 'devisNumber'].includes(last)) {
    return translateOrHumanize(parent, t);
  }

  return translateOrHumanize(last, t);
}

export function formatAuditValue(
  value: unknown,
  path: string,
  t: TFunction,
  language: string,
  log?: AuditLog
): string {
  if (isAuditEmptyValue(value)) return EMPTY_MARK;

  const locale = language || 'en';
  const resolvedEntity = resolveEntityName(value, path, log);
  if (resolvedEntity) return resolvedEntity;

  if (typeof value === 'boolean') {
    return value ? translateValue('auditLogs.boolean.yes', t, 'Yes') : translateValue('auditLogs.boolean.no', t, 'No');
  }

  if (typeof value === 'number') {
    if (isPercentageField(path)) return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value) + ' %';
    if (isMoneyField(path)) {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: resolveCurrency(log),
        currencyDisplay: 'code',
      }).format(value);
    }
    return new Intl.NumberFormat(locale).format(value);
  }

  if (Array.isArray(value)) {
    const formatted = value
      .map((item) => formatAuditValue(item, path, t, language, log))
      .filter((item) => !isAuditEmptyDisplay(item));
    return formatted.length ? formatted.join(', ') : EMPTY_MARK;
  }

  if (typeof value === 'object') {
    const rows = buildAuditSummaryRows(value as Record<string, unknown>, t, language, log ?? emptyAuditLog());
    return rows.length ? rows.map((row) => `${row.label}: ${row.formattedValue}`).join(' • ') : EMPTY_MARK;
  }

  const stringValue = String(value).trim();
  if (!stringValue) return EMPTY_MARK;

  if (isIsoDateLike(stringValue)) {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: hasTime(stringValue) ? 'short' : undefined,
    }).format(new Date(stringValue));
  }

  const enumValue = translateEnumValue(stringValue, t);
  if (enumValue) return enumValue;

  if (looksLikeUuid(stringValue)) return shortenId(stringValue);
  return stringValue;
}

export function resolveEntityName(value: unknown, path: string, log?: AuditLog): string | undefined {
  if (typeof value !== 'string' || !looksLikeUuid(value)) return undefined;
  if (path === 'userId' && log?.user?.name) return log.user.name;

  const oldFlat = flattenAuditObject(log?.oldValues);
  const newFlat = flattenAuditObject(log?.newValues);
  const combined = { ...oldFlat, ...newFlat };
  const base = path.replace(/Id$/, '').replace(/_id$/, '');
  const candidates = [
    ...ENTITY_NAME_PATHS.map((namePath) => `${base}.${namePath}`),
    ...ENTITY_NAME_PATHS.map((namePath) => `${base}_${namePath}`),
  ];
  const found = candidates
    .map((candidate) => combined[candidate])
    .find((candidate) => typeof candidate === 'string' && candidate.trim());

  if (typeof found === 'string') return entityPrefix(path, found);
  return shortenId(value);
}

export function flattenAuditObject(value: unknown, prefix = ''): FlatValues {
  if (isAuditEmptyValue(value)) return {};
  if (Array.isArray(value)) return { [prefix]: value };
  if (typeof value !== 'object') return prefix ? { [prefix]: value } : {};

  return Object.entries(value as Record<string, unknown>).reduce<FlatValues>((acc, [key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child) && Object.keys(child as Record<string, unknown>).length > 0) {
      Object.assign(acc, flattenAuditObject(child, path));
    } else {
      acc[path] = child;
    }
    return acc;
  }, {});
}

export function formatAuditModuleLabel(module: string | null | undefined, t: TFunction): string {
  if (!module) return EMPTY_MARK;
  return translateRecordValue('auditLogs.modules', module, t);
}

export function formatAuditEntityLabel(entity: string | null | undefined, t: TFunction): string {
  if (!entity) return EMPTY_MARK;
  return translateRecordValue('auditLogs.entities', entity, t);
}

export function normalizeAuditBrowserName(browser: string | null | undefined, userAgent?: string | null): string {
  const source = `${browser ?? ''} ${userAgent ?? ''}`.toLowerCase();
  if (!source.trim()) return EMPTY_MARK;
  if (source.includes('edg/')) return 'Microsoft Edge';
  if (source.includes('opr/') || source.includes('opera')) return 'Opera';
  if (source.includes('firefox')) return 'Firefox';
  if (source.includes('samsungbrowser')) return 'Samsung Internet';
  if (source.includes('chrome') || source.includes('chromium') || source.includes('crios')) return 'Chrome';
  if (source.includes('safari')) return 'Safari';
  return browser && browser.toLowerCase() !== 'other' ? browser : EMPTY_MARK;
}

export function getAuditPermissionSummary(log: AuditLog): AuditPermissionSummary | null {
  const metadata = log.metadata ?? {};
  const permissions = Array.isArray(metadata.permissions)
    ? metadata.permissions.filter((item): item is string => typeof item === 'string')
    : [];
  const explicitPermission = [
    metadata.usedPermission,
    metadata.permissionUsed,
    metadata.requiredPermission,
    metadata.permission,
    metadata.permissionKey,
  ].find((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const inferredPermission = explicitPermission ?? inferPermissionFromLog(log, permissions);

  if (!permissions.length && !inferredPermission) return null;
  return {
    count: permissions.length,
    permissions,
    usedPermission: inferredPermission,
  };
}

export function isAuditEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '' || value.trim() === EMPTY_MARK;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length === 0;
  return false;
}

function isAuditEmptyDisplay(value: string): boolean {
  return value.trim() === '' || value.trim() === EMPTY_MARK;
}

function translateOrHumanize(value: string, t: TFunction): string {
  const fallbackKey = FIELD_FALLBACKS[value] ?? FIELD_FALLBACKS[value.replace(/Id$/, '')];
  const translationKey = `auditLogs.fields.${value}`;
  const translated = t(translationKey, { defaultValue: '' });
  if (isResolvedTranslation(translated, translationKey)) return translated;
  return fallbackKey ?? humanizeField(value);
}

function translateEnumValue(value: string, t: TFunction): string | undefined {
  const translationKey = `auditLogs.statusValues.${value}`;
  const translated = t(translationKey, { defaultValue: '' });
  if (isResolvedTranslation(translated, translationKey)) return translated;
  if (/^[A-Z][A-Z0-9_]+$/.test(value)) return humanizeField(value.toLowerCase());
  return undefined;
}

function translateValue(key: string, t: TFunction, fallback: string): string {
  const translated = t(key, { defaultValue: '' });
  return isResolvedTranslation(translated, key) ? translated : fallback;
}

function translateRecordValue(namespace: string, value: string, t: TFunction): string {
  const normalized = value.replace(/\./g, '_');
  const keys = [
    `${namespace}.${value}`,
    `${namespace}.${normalized}`,
    `${namespace}.${value.toLowerCase()}`,
    `${namespace}.${normalized.toLowerCase()}`,
    `${namespace}.${value.toUpperCase()}`,
    `${namespace}.${normalized.toUpperCase()}`,
  ];

  for (const key of keys) {
    const translated = t(key, { defaultValue: '' });
    if (isResolvedTranslation(translated, key)) return translated;
  }

  return humanizeField(value);
}

function isResolvedTranslation(value: string, key: string): boolean {
  return Boolean(value) && value !== key && !value.toLowerCase().startsWith('auditlogs.');
}

function humanizeField(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\bid\b/i, '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isMoneyField(path: string): boolean {
  return /(amount|total|subtotal|price|balance|paid|discount|taxAmount|unitRate|fixedAmount|rate)$/i.test(path) && !isPercentageField(path);
}

function isPercentageField(path: string): boolean {
  return /(taxRate|vatRate|percentage|percent)$/i.test(path);
}

function resolveCurrency(log?: AuditLog): string {
  const flat = { ...flattenAuditObject(log?.oldValues), ...flattenAuditObject(log?.newValues) };
  const value = flat.currency;
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : 'MAD';
}

function isIsoDateLike(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(T|\s|$)/.test(value) && !Number.isNaN(Date.parse(value));
}

function hasTime(value: string): boolean {
  return /T\d{2}:\d{2}/.test(value);
}

function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function shortenId(value: string): string {
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function entityPrefix(path: string, value: string): string {
  if (/invoice/i.test(path)) return `Invoice ${value}`;
  return value;
}

function inferPermissionFromLog(log: AuditLog, permissions: string[]): string | undefined {
  const moduleName = log.module?.replace(/_/g, '-') ?? '';
  const entity = log.entity?.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase() ?? '';
  const resource = moduleName || entity;
  const action = actionToPermissionVerb(log.action);
  if (!resource || !action) return undefined;

  const candidates = [
    `${resource}.${action}`,
    `${resource.replace(/-/g, '_')}.${action}`,
    `${resource.replace(/-/g, '')}.${action}`,
  ];
  return candidates.find((candidate) => permissions.includes(candidate));
}

function actionToPermissionVerb(action: string): string | undefined {
  const normalized = action.toUpperCase();
  if (normalized.includes('CREATE')) return 'create';
  if (normalized.includes('UPDATE') || normalized.includes('STATUS_CHANGED')) return 'update';
  if (normalized.includes('DELETE')) return 'delete';
  if (normalized.includes('VIEW')) return 'view';
  if (normalized.includes('APPROVE')) return 'approve';
  if (normalized.includes('REJECT')) return 'reject';
  if (normalized.includes('EXPORT')) return 'export';
  if (normalized.includes('PDF')) return 'pdf.download';
  if (normalized.includes('EMAIL')) return 'email.send';
  return undefined;
}

function auditFieldWeight(path: string): number {
  const order = ['invoiceNumber', 'creditNoteNumber', 'contractNumber', 'devisNumber', 'name', 'customer', 'client', 'email', 'status', 'total', 'currency', 'issueDate', 'dueDate'];
  const found = order.findIndex((item) => path.toLowerCase().includes(item.toLowerCase()));
  return found === -1 ? 100 : found;
}

function emptyAuditLog(): AuditLog {
  return {
    id: '',
    module: '',
    entity: '',
    action: '',
    success: true,
    createdAt: new Date().toISOString(),
  };
}
