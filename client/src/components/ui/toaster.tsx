import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useContext } from 'react';
import { ToastContext } from '@/contexts/toast-context';
import type { ToastVariant } from '@/types/notification';

const toastStyles: Record<ToastVariant, { icon: typeof Info; iconClass: string; borderClass: string }> = {
  success: {
    icon: CheckCircle2,
    iconClass: 'text-emerald-600 dark:text-emerald-300',
    borderClass: 'border-emerald-200 dark:border-emerald-900/60',
  },
  error: {
    icon: XCircle,
    iconClass: 'text-rose-600 dark:text-rose-300',
    borderClass: 'border-rose-200 dark:border-rose-900/60',
  },
  warning: {
    icon: AlertTriangle,
    iconClass: 'text-amber-600 dark:text-amber-300',
    borderClass: 'border-amber-200 dark:border-amber-900/60',
  },
  info: {
    icon: Info,
    iconClass: 'text-primary',
    borderClass: 'border-border',
  },
};

export function Toaster() {
  const context = useContext(ToastContext);
  if (!context || context.toasts.length === 0) return null;

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end" role="status">
      {context.toasts.map((toast) => {
        const styles = toastStyles[toast.variant];
        const Icon = styles.icon;

        return (
          <div className={`pointer-events-auto flex w-full max-w-sm gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-xl ${styles.borderClass}`} key={toast.id}>
            <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${styles.iconClass}`} />
            <div className="min-w-0 flex-1">
              {toast.title ? <p className="text-sm font-semibold text-foreground">{toast.title}</p> : null}
              <div className="text-sm leading-5 text-foreground">{toast.message}</div>
              {toast.description ? <div className="mt-1 text-sm leading-5 text-muted-foreground">{toast.description}</div> : null}
            </div>
            <button aria-label="Dismiss notification" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus:outline-none focus:ring-4 focus:ring-ring/20" onClick={() => context.dismiss(toast.id)} type="button">
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
