const formulaInjectionPattern = /^\s*[=+\-@]/;

export function sanitizeExcelString(value: string): string {
  return formulaInjectionPattern.test(value) ? `'${value}` : value;
}

export function sanitizeExcelValue<T>(value: T): T | string {
  if (typeof value === 'string') {
    return sanitizeExcelString(value);
  }

  return value;
}
