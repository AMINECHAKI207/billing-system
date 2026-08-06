import { Prisma } from '@prisma/client';

const SENSITIVE_FIELD_PATTERNS = [
  /password/i,
  /passwordHash/i,
  /token/i,
  /jwt/i,
  /secret/i,
  /privateKey/i,
  /apiKey/i,
  /authorization/i,
  /cookie/i,
  /otp/i,
  /cardNumber/i,
  /creditCard/i,
  /cvv/i,
];

const MODEL_MODULES: Record<string, string> = {
  User: 'users',
  RbacRole: 'roles',
  Permission: 'permissions',
  RolePermission: 'permissions',
  Customer: 'clients',
  Invoice: 'invoices',
  InvoiceItem: 'invoices',
  Payment: 'payments',
  ExpenseNote: 'expense_notes',
  ExpenseAttachment: 'expense_notes',
  ExpenseCategory: 'expense_notes',
  ExpenseType: 'expense_notes',
  CreditNote: 'credit_notes',
  CreditNoteLine: 'credit_notes',
  CreditNoteReason: 'credit_notes',
  Contract: 'contracts',
  ContractVersion: 'contracts',
  ContractTimeEntry: 'contracts',
  ContractMilestone: 'contracts',
  Devis: 'devis',
  DevisItem: 'devis',
  Product: 'catalogue',
  CompanySettings: 'settings',
  Notification: 'notifications',
};

export function moduleForModel(model: string): string {
  return MODEL_MODULES[model] ?? model.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
}

export function actionForOperation(operation: string, oldRecord?: unknown): string {
  if (operation === 'create') return 'CREATE';
  if (operation === 'update') return 'UPDATE';
  if (operation === 'delete') return 'DELETE';
  if (operation === 'upsert') return oldRecord ? 'UPDATE' : 'CREATE';
  return operation.toUpperCase();
}

export function extractEntityId(record: unknown, args?: unknown): string | null {
  const fromRecord = record && typeof record === 'object' && 'id' in record ? (record as { id?: unknown }).id : undefined;
  if (fromRecord !== undefined && fromRecord !== null) return String(fromRecord);
  const where = args && typeof args === 'object' && 'where' in args ? (args as { where?: unknown }).where : undefined;
  if (where && typeof where === 'object' && 'id' in where) return String((where as { id?: unknown }).id);
  return null;
}

export function sanitizeAuditValue(value: unknown): Prisma.InputJsonValue {
  return sanitizeValue(value) as Prisma.InputJsonValue;
}

export function sanitizeAuditObject(value: unknown): Prisma.InputJsonObject | undefined {
  const sanitized = sanitizeValue(value);
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? sanitized as Prisma.InputJsonObject
    : undefined;
}

export function diffRecords(oldRecord: unknown, newRecord: unknown) {
  const oldObject = toPlainObject(oldRecord);
  const newObject = toPlainObject(newRecord);
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};

  for (const key of Object.keys(newObject)) {
    if (key === 'updatedAt') continue;
    const oldValue = oldObject[key];
    const newValue = newObject[key];
    if (JSON.stringify(normalizeComparable(oldValue)) !== JSON.stringify(normalizeComparable(newValue))) {
      oldValues[key] = oldValue;
      newValues[key] = newValue;
    }
  }

  return {
    oldValues: Object.keys(oldValues).length ? sanitizeAuditObject(oldValues) : undefined,
    newValues: Object.keys(newValues).length ? sanitizeAuditObject(newValues) : undefined,
  };
}

export function userAgentDetails(userAgent?: string) {
  const value = userAgent ?? '';
  const browser = /Edg\//.test(value) ? 'Edge'
    : /Chrome\//.test(value) ? 'Chrome'
      : /Firefox\//.test(value) ? 'Firefox'
        : /Safari\//.test(value) ? 'Safari'
          : value ? 'Other' : undefined;
  const operatingSystem = /Windows/i.test(value) ? 'Windows'
    : /Mac OS X|Macintosh/i.test(value) ? 'macOS'
      : /Android/i.test(value) ? 'Android'
        : /iPhone|iPad|iOS/i.test(value) ? 'iOS'
          : /Linux/i.test(value) ? 'Linux'
            : value ? 'Other' : undefined;
  const device = /Mobile|Android|iPhone/i.test(value) ? 'Mobile'
    : /iPad|Tablet/i.test(value) ? 'Tablet'
      : value ? 'Desktop' : undefined;
  return { browser, operatingSystem, device };
}

function sanitizeValue(value: unknown, key = ''): unknown {
  if (SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(key))) return '[REDACTED]';
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Prisma.Decimal) return value.toString();
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, key));
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      output[childKey] = sanitizeValue(childValue, childKey);
    }
    return output;
  }
  return String(value);
}

function sanitizeString(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000);
}

function toPlainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  return value as Record<string, unknown>;
}

function normalizeComparable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Prisma.Decimal) return value.toString();
  return value;
}
