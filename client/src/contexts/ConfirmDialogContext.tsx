import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ConfirmDialogContext, type ConfirmDialogContextValue } from '@/contexts/confirm-dialog-context';
import type { ConfirmDialogOptions } from '@/types/notification';

type PendingConfirmation = {
  options: ConfirmDialogOptions;
  resolve: (accepted: boolean) => void;
};

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const resolverRef = useRef<((accepted: boolean) => void) | null>(null);

  const settle = useCallback((accepted: boolean) => {
    resolverRef.current?.(accepted);
    resolverRef.current = null;
    setPending(null);
  }, []);

  const confirm = useCallback<ConfirmDialogContextValue>((options) => {
    resolverRef.current?.(false);

    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setPending({ options, resolve });
    });
  }, []);

  useEffect(() => {
    if (!pending) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') settle(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [pending, settle]);

  useEffect(() => () => resolverRef.current?.(false), []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmDialogContext.Provider value={value}>
      {children}
      <ConfirmDialog isOpen={Boolean(pending)} onCancel={() => settle(false)} onConfirm={() => settle(true)} options={pending?.options ?? null} />
    </ConfirmDialogContext.Provider>
  );
}
