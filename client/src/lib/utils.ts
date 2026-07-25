import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * cn() — Class Name Utility
 *
 * Combines clsx (conditional classes) with tailwind-merge
 * (deduplicates conflicting Tailwind classes).
 *
 * Example:
 *   cn('px-4 py-2', isActive && 'bg-primary', 'px-6')
 *   → 'py-2 bg-primary px-6'  (px-4 is overridden by px-6)
 *
 * WHY tailwind-merge?
 * Without it, 'px-4 px-6' would both be applied and the last
 * one wins (browser behavior). With it, conflicts are resolved
 * intelligently at the JS level.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Format currency amount to MAD (Moroccan Dirham)
 */
export function formatCurrency(
  amount: number,
  currency = 'MAD',
  locale = 'fr-MA'
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format date to readable string
 */
export function formatDate(
  date: string | Date,
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }
): string {
  return new Intl.DateTimeFormat('en-US', options).format(new Date(date));
}

/**
 * Calculate days until (positive) or overdue by (negative)
 */
export function getDaysUntilDue(dueDate: string | Date): number {
  const now = new Date();
  const due = new Date(dueDate);
  const diff = due.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

/**
 * Truncate text to a maximum length with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

/**
 * Debounce a function call (for search inputs)
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}
