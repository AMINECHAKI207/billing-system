import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { ConfirmDialogProvider } from '@/contexts/ConfirmDialogContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { queryClient } from '@/lib/queryClient';
import { initializeTheme } from '@/lib/theme';
import App from './App';
import './i18n'; // Import the i18n configuration
import './index.css';

initializeTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConfirmDialogProvider>
        <ToastProvider>
          <App />
          <Toaster />
        </ToastProvider>
      </ConfirmDialogProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
