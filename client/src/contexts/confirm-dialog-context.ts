import { createContext } from 'react';
import type { ConfirmDialogOptions } from '@/types/notification';

export type ConfirmDialogContextValue = (options: ConfirmDialogOptions) => Promise<boolean>;

export const ConfirmDialogContext = createContext<ConfirmDialogContextValue | null>(null);
