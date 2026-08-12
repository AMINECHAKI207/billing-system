import { Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getContracts,
  getCreditNoteReasons,
  getCustomers,
  getExpenseCategories,
  getExpenseTypes,
  getInvoices,
  getProducts,
  getRbacPermissions,
  getRbacRoles,
  getRbacUsers,
  type AiStructuredForm,
  type AiStructuredFormField,
} from '@/lib/api';

type Props = {
  form: AiStructuredForm;
  disabled?: boolean;
  fieldErrors?: Record<string, string>;
  storageKey: string;
  onSubmit: (values: Record<string, unknown>) => void;
};

export function AiBusinessForm({ form, disabled = false, fieldErrors = {}, storageKey, onSubmit }: Props) {
  const [values, setValues] = useState<Record<string, unknown>>(() => loadStoredDraft(storageKey, form.values));

  useEffect(() => {
    setValues(loadStoredDraft(storageKey, form.values));
  }, [form.toolName, form.title, form.values, storageKey]);

  useEffect(() => {
    sessionStorage.setItem(storageKey, JSON.stringify(values));
  }, [storageKey, values]);

  const visibleFields = useMemo(() => form.fields.filter((field) => !field.hidden), [form.fields]);

  const submit = () => onSubmit(values);

  return (
    <article className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-4 dark:border-primary/20 dark:bg-primary/10">
      <div className="mb-4">
        <h4 className="text-sm font-semibold text-slate-950 dark:text-slate-50">{form.title}</h4>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{form.description}</p>
      </div>

      <div className="space-y-4">
        {visibleFields.map((field) => (
          <BusinessFieldRenderer
            disabled={disabled}
            field={field}
            key={field.path}
            onChange={(nextValue) => setValues((current) => setValueAtPath(current, field.path, nextValue))}
            value={getValueAtPath(values, field.path) ?? field.value}
            error={fieldErrors[field.path]}
          />
        ))}
      </div>

      <div className="mt-4 flex justify-end">
        <button
          className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:opacity-60"
          disabled={disabled}
          onClick={submit}
          type="button"
        >
          {disabled ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {form.submitLabel}
        </button>
      </div>
    </article>
  );
}

function BusinessFieldRenderer({
  field,
  value,
  error,
  disabled,
  onChange,
}: {
  field: AiStructuredFormField;
  value: unknown;
  error?: string;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation();
  const commonClassName = `w-full rounded-md border px-3 text-sm outline-none ring-primary/20 transition focus:ring-4 ${
    error
      ? 'border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/20'
      : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100'
  }`;

  if (field.type === 'array') {
    const items = Array.isArray(value) ? value : [];
    const itemFields = field.itemFields ?? [];
    return (
      <div className="space-y-2">
        <FieldLabel field={field} />
        <div className="space-y-3">
          {items.map((item, index) => {
            const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
            return (
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800" key={`${field.path}-${index}`}>
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase text-slate-500">{t('aiAssistant.lineItem', { index: index + 1 })}</span>
                  <button
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 px-2 text-xs text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"
                    disabled={disabled}
                    onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
                    type="button"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t('common.delete')}
                  </button>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {itemFields.filter((itemField) => !itemField.hidden).map((itemField) => (
                    <BusinessFieldRenderer
                      disabled={disabled}
                      error={undefined}
                      field={{ ...itemField, path: `${field.path}.${index}.${itemField.path}` }}
                      key={`${field.path}.${index}.${itemField.path}`}
                      onChange={(nextValue) => {
                        const nextItems = [...items];
                        const nextRow = { ...row };
                        nextItems[index] = setValueAtPath(nextRow, itemField.path, nextValue);
                        onChange(nextItems);
                      }}
                      value={row[itemField.path]}
                    />
                  ))}
                </div>
              </div>
            );
          })}
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-dashed border-primary/30 px-3 text-sm font-medium text-primary transition hover:bg-primary/5 disabled:opacity-60"
            disabled={disabled}
            onClick={() => onChange([...items, buildEmptyArrayItem(itemFields)])}
            type="button"
          >
            <Plus className="h-4 w-4" />
            {t('aiAssistant.addLine')}
          </button>
        </div>
        {error ? <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p> : null}
      </div>
    );
  }

  if (field.type === 'entity') {
    return (
      <EntitySelectorField
        disabled={disabled || Boolean(field.readOnly)}
        error={error}
        field={field}
        onChange={onChange}
        value={value}
      />
    );
  }

  if (field.readOnly) {
    return (
      <div className="space-y-1">
        <FieldLabel field={field} />
        <div className={`${commonClassName} flex min-h-10 items-center py-2 text-slate-700 dark:text-slate-200`}>
          {field.displayValue || stringifyValue(value) || '—'}
        </div>
      </div>
    );
  }

  return (
    <label className="block space-y-1">
      <FieldLabel field={field} />
      {renderInput(field, value, commonClassName, disabled, onChange)}
      {error ? <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p> : null}
    </label>
  );
}

function EntitySelectorField({
  field,
  value,
  error,
  disabled,
  onChange,
}: {
  field: AiStructuredFormField;
  value: unknown;
  error?: string;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const resultsQuery = useQuery({
    queryKey: ['ai-assistant', 'entity-search', field.entityType, query],
    queryFn: async () => {
      if (field.entityType === 'customer') {
        const result = await getCustomers({ search: query, limit: 8 });
        return result.data.map((row) => ({ id: row.id, label: row.company || row.name || row.email }));
      }
      if (field.entityType === 'contract') {
        const result = await getContracts({ search: query, limit: 8 });
        return result.data.map((row) => ({ id: row.id, label: row.contractNumber || row.title }));
      }
      if (field.entityType === 'product') {
        const result = await getProducts({ search: query, limit: 8 });
        return result.data.map((row) => ({ id: row.id, label: row.name }));
      }
      if (field.entityType === 'invoice') {
        const result = await getInvoices({ search: query, limit: 8 });
        return result.data.map((row) => ({ id: row.id, label: row.invoiceNumber || row.id }));
      }
      if (field.entityType === 'expenseCategory') {
        const result = await getExpenseCategories(true);
        return result
          .filter((row) => !query || row.name.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 8)
          .map((row) => ({ id: row.id, label: row.name }));
      }
      if (field.entityType === 'expenseType') {
        const result = await getExpenseTypes({ active: true });
        return result
          .filter((row) => !query || row.name.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 8)
          .map((row) => ({ id: row.id, label: row.name }));
      }
      if (field.entityType === 'user') {
        const result = await getRbacUsers({ search: query, limit: '8' });
        return result.data.map((row) => ({ id: row.id, label: row.name || row.email }));
      }
      if (field.entityType === 'role') {
        const result = await getRbacRoles();
        return result
          .filter((row) => !query || row.name.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 8)
          .map((row) => ({ id: row.id, label: row.name }));
      }
      if (field.entityType === 'permission') {
        const result = await getRbacPermissions();
        return result
          .filter((row) => !query || row.key.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 8)
          .map((row) => ({ id: row.id, label: row.key }));
      }
      if (field.entityType === 'creditNoteReason') {
        const result = await getCreditNoteReasons(false);
        return result
          .filter((row) => !query || row.nameFr.toLowerCase().includes(query.toLowerCase()) || row.nameEn.toLowerCase().includes(query.toLowerCase()) || row.code.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 8)
          .map((row) => ({ id: row.id, label: row.nameFr || row.nameEn || row.code }));
      }
      return [];
    },
    enabled: !disabled && query.trim().length >= 2,
    staleTime: 30_000,
  });

  return (
    <div className="space-y-1">
      <FieldLabel field={field} />
      {field.readOnly ? (
        <div className="flex min-h-10 items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
          {field.displayValue || stringifyValue(value) || '—'}
        </div>
      ) : (
        <div className="space-y-2">
          <div className={`flex items-center gap-2 rounded-md border px-3 ${error ? 'border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/20' : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'}`}>
            <Search className="h-4 w-4 text-slate-400" />
            <input
              className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none dark:text-slate-100"
              disabled={disabled}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={field.displayValue || field.placeholder || t('common.search')}
              type="text"
              value={query}
            />
          </div>
          {field.displayValue && !query ? (
            <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-slate-700 dark:text-slate-200">
              {field.displayValue}
            </div>
          ) : null}
          {resultsQuery.data?.length ? (
            <div className="max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              {resultsQuery.data.map((item) => (
                <button
                  className="block w-full px-3 py-2 text-start text-sm transition hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-800"
                  key={item.id}
                  onClick={() => {
                    onChange(item.id);
                    setQuery(item.label);
                  }}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
      {error ? <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p> : null}
    </div>
  );
}

function FieldLabel({ field }: { field: AiStructuredFormField }) {
  return (
    <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
      {field.label}
      {field.required ? ' *' : ''}
    </span>
  );
}

function renderInput(
  field: AiStructuredFormField,
  value: unknown,
  className: string,
  disabled: boolean,
  onChange: (value: unknown) => void
) {
  switch (field.type) {
    case 'textarea':
      return (
        <textarea
          className={`${className} min-h-[96px] py-2`}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          value={typeof value === 'string' ? value : ''}
        />
      );
    case 'number':
    case 'currency':
      return (
        <input
          className={`${className} h-10`}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
          placeholder={field.placeholder}
          step={field.type === 'currency' ? '0.01' : '1'}
          type="number"
          value={typeof value === 'number' ? value : value == null ? '' : String(value)}
        />
      );
    case 'date':
      return (
        <input
          className={`${className} h-10`}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value || null)}
          type="date"
          value={typeof value === 'string' ? value.slice(0, 10) : ''}
        />
      );
    case 'datetime':
      return (
        <input
          className={`${className} h-10`}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value || null)}
          type="datetime-local"
          value={typeof value === 'string' ? normalizeDatetimeLocal(value) : ''}
        />
      );
    case 'boolean':
      return (
        <select
          className={`${className} h-10`}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value === 'true')}
          value={value === true ? 'true' : 'false'}
        >
          <option value="true">Oui</option>
          <option value="false">Non</option>
        </select>
      );
    case 'select':
      return (
        <select
          className={`${className} h-10`}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value || null)}
          value={typeof value === 'string' ? value : ''}
        >
          <option value="">{field.placeholder || '—'}</option>
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    default:
      return (
        <input
          className={`${className} h-10`}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          type="text"
          value={typeof value === 'string' ? value : value == null ? '' : String(value)}
        />
      );
  }
}

function buildEmptyArrayItem(fields: NonNullable<AiStructuredFormField['itemFields']>) {
  const item: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.type === 'number' || field.type === 'currency') item[field.path] = 0;
    else if (field.type === 'boolean') item[field.path] = false;
    else item[field.path] = '';
  }
  return item;
}

function getValueAtPath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (Array.isArray(current)) {
      const index = Number(segment);
      return Number.isInteger(index) ? current[index] : undefined;
    }
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[segment];
  }, source);
}

function setValueAtPath(source: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const clone = structuredClone(source);
  const segments = path.split('.');
  const last = segments.pop();
  if (!last) return clone;
  let current: Record<string, unknown> | unknown[] = clone;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      current[index] = current[index] && typeof current[index] === 'object' ? current[index] : {};
      current = current[index] as Record<string, unknown>;
      continue;
    }
    current[segment] = current[segment] && typeof current[segment] === 'object' ? current[segment] : {};
    current = current[segment] as Record<string, unknown>;
  }
  if (Array.isArray(current)) {
    current[Number(last)] = value;
  } else {
    current[last] = value;
  }
  return clone;
}

function stringifyValue(value: unknown) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function normalizeDatetimeLocal(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function loadStoredDraft(storageKey: string, fallback: Record<string, unknown>) {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}
