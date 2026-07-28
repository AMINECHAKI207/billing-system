import { createContext } from 'react';
import type { ToastApi, ToastItem } from '@/types/notification';

export type ToastContextValue = ToastApi & {
  toasts: ToastItem[];
};

export const ToastContext = createContext<ToastContextValue | null>(null);
