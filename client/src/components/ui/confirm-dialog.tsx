import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { ConfirmDialogOptions, NotificationVariant } from '@/types/notification';

type ConfirmDialogProps = {
  isOpen: boolean;
  options: ConfirmDialogOptions | null;
  onCancel: () => void;
  onConfirm: () => void;
};

const variantClasses: Record<NotificationVariant, { icon: typeof Info; iconClass: string; buttonClass: string }> = {
  danger: {
    icon: XCircle,
    iconClass: 'bg-rose-50 text-rose-600 ring-rose-100 dark:bg-rose-950/30 dark:text-rose-300 dark:ring-rose-900/50',
    buttonClass: 'bg-rose-600 text-white hover:bg-rose-700 focus:ring-rose-500',
  },
  warning: {
    icon: AlertTriangle,
    iconClass: 'bg-amber-50 text-amber-600 ring-amber-100 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/50',
    buttonClass: 'bg-amber-500 text-white hover:bg-amber-600 focus:ring-amber-500',
  },
  info: {
    icon: Info,
    iconClass: 'bg-primary/10 text-primary ring-primary/15',
    buttonClass: 'bg-primary text-primary-foreground hover:bg-primary/90 focus:ring-ring',
  },
  success: {
    icon: CheckCircle2,
    iconClass: 'bg-emerald-50 text-emerald-600 ring-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/50',
    buttonClass: 'bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-emerald-500',
  },
};

export function ConfirmDialog({ isOpen, options, onCancel, onConfirm }: ConfirmDialogProps) {
  if (!isOpen || !options) return null;

  const variant = options.variant ?? 'info';
  const styles = variantClasses[variant];
  const Icon = styles.icon;

  return (
    <div aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="dialog">
      <button aria-label="Close confirmation dialog" className="absolute inset-0 h-full w-full cursor-default" onClick={onCancel} type="button" />
      <div className="relative w-full max-w-md rounded-xl border border-border bg-card p-5 text-card-foreground shadow-2xl">
        <div className="flex items-start gap-3">
          <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1 ${styles.iconClass}`}>
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-foreground">{options.title}</h2>
            {options.description ? <div className="mt-2 text-sm leading-6 text-muted-foreground">{options.description}</div> : null}
          </div>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className="inline-flex h-9 items-center justify-center rounded-md border border-border px-3 text-sm font-medium text-foreground transition hover:bg-muted focus:outline-none focus:ring-4 focus:ring-ring/20" onClick={onCancel} type="button">
            {options.cancelText ?? 'Cancel'}
          </button>
          <button className={`inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium transition focus:outline-none focus:ring-4 focus:ring-offset-0 ${styles.buttonClass}`} onClick={onConfirm} type="button">
            {options.confirmText ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
