import type { ReactNode } from 'react';

export type NotificationVariant = 'danger' | 'warning' | 'info' | 'success';

export type ConfirmDialogOptions = {
  title: ReactNode;
  description?: ReactNode;
  confirmText?: ReactNode;
  cancelText?: ReactNode;
  variant?: NotificationVariant;
};

export type ToastVariant = Exclude<NotificationVariant, 'danger'> | 'error';

export type ToastOptions = {
  id?: string;
  title?: ReactNode;
  description?: ReactNode;
  duration?: number;
};

export type ToastItem = Required<Pick<ToastOptions, 'id'>> &
  Omit<ToastOptions, 'id'> & {
    message: ReactNode;
    variant: ToastVariant;
  };

export type ToastApi = {
  success: (message: ReactNode, options?: ToastOptions) => string;
  error: (message: ReactNode, options?: ToastOptions) => string;
  warning: (message: ReactNode, options?: ToastOptions) => string;
  info: (message: ReactNode, options?: ToastOptions) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
};
