import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ToastContext, type ToastContextValue } from '@/contexts/toast-context';
import type { ToastItem, ToastOptions, ToastVariant } from '@/types/notification';

const DEFAULT_TOAST_DURATION = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setToasts([]);
  }, []);

  const show = useCallback((variant: ToastVariant, message: ReactNode, options: ToastOptions = {}) => {
    const id = options.id ?? crypto.randomUUID();
    const toast: ToastItem = {
      id,
      message,
      variant,
      title: options.title,
      description: options.description,
      duration: options.duration ?? DEFAULT_TOAST_DURATION,
    };

    setToasts((current) => [toast, ...current.filter((item) => item.id !== id)].slice(0, 5));

    if ((toast.duration ?? 0) > 0) {
      window.setTimeout(() => dismiss(id), toast.duration);
    }

    return id;
  }, [dismiss]);

  const value = useMemo<ToastContextValue>(() => ({
    toasts,
    success: (message, options) => show('success', message, options),
    error: (message, options) => show('error', message, options),
    warning: (message, options) => show('warning', message, options),
    info: (message, options) => show('info', message, options),
    dismiss,
    dismissAll,
  }), [dismiss, dismissAll, show, toasts]);

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}
