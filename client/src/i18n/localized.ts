import type { TFunction } from 'i18next';

export type SupportedLanguage = 'en' | 'fr' | 'ar';
export type Direction = 'ltr' | 'rtl';

const statusKeyNamespaces = {
  expense: 'expenses.status.workflow',
  expenseAudit: 'expenses.audit',
  creditNote: 'creditNotes.status',
  creditNoteAction: 'creditNotes.actions',
  payment: 'auditFinal.paymentStatus',
  reminder: 'auditFinal.reminderStatus',
  email: 'expenses.emailStatus',
} as const;

export type LocalizedStatusGroup = keyof typeof statusKeyNamespaces;

export function normalizeLanguage(language?: string): SupportedLanguage {
  const normalized = (language || 'fr').split('-')[0];
  if (normalized === 'ar') return 'ar';
  if (normalized === 'en') return 'en';
  return 'fr';
}

export function getLanguageDirection(language?: string): Direction {
  return normalizeLanguage(language) === 'ar' ? 'rtl' : 'ltr';
}

export function applyDocumentDirection(language?: string, root: HTMLElement = document.documentElement) {
  const normalized = normalizeLanguage(language);
  root.lang = normalized;
  root.dir = getLanguageDirection(normalized);
}

export function translateStatus(t: TFunction, group: LocalizedStatusGroup, value?: string | null) {
  if (!value) return t('common.unknown', { defaultValue: '-' });
  const namespace = statusKeyNamespaces[group];
  const key = `${namespace}.${value}`;
  const translated = t(key);

  if (import.meta.env.DEV && translated === key) {
    console.warn(`[i18n] Missing status translation: ${key}`);
  }

  return translated === key ? value : translated;
}

export function translateExpenseStatus(t: TFunction, value?: string | null) {
  return translateStatus(t, 'expense', value);
}

export function translateAuditEvent(t: TFunction, value?: string | null) {
  return translateStatus(t, 'expenseAudit', value);
}

export function formatLocalizedDate(value: string | Date | null | undefined, language?: string, options: Intl.DateTimeFormatOptions = {}) {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(resolveIntlLocale(language), {
    dateStyle: 'medium',
    ...options,
  }).format(date);
}

export function formatLocalizedNumber(value: number | null | undefined, language?: string, options: Intl.NumberFormatOptions = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return new Intl.NumberFormat(resolveIntlLocale(language), options).format(value);
}

export function formatLocalizedCurrency(value: number | null | undefined, currency = 'MAD', language?: string) {
  return formatLocalizedNumber(value, language, {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
  });
}

export function localizedErrorFallback(t: TFunction, key = 'common.error') {
  const translated = t(key);
  return translated === key ? t('common.unknown', { defaultValue: 'Unknown error' }) : translated;
}

export function resolveIntlLocale(language?: string) {
  const normalized = normalizeLanguage(language);
  if (normalized === 'ar') return 'ar-MA';
  if (normalized === 'en') return 'en-US';
  return 'fr-MA';
}
