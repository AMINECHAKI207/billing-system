import { QueryClient } from '@tanstack/react-query';

/**
 * TanStack Query Client Configuration
 *
 * defaultOptions apply to ALL queries/mutations unless overridden per-hook.
 *
 * Key decisions:
 * - staleTime: 5 minutes — data is considered "fresh" for 5 min.
 *   No refetch on window focus unless data is older than this.
 *   WHY: Our data (invoices, customers) doesn't change every second.
 *   Reduces unnecessary API calls.
 *
 * - gcTime: 10 minutes — unused query results stay in cache for 10 min.
 *   If user navigates back to a page within 10 min, data loads instantly.
 *
 * - retry: 1 — retry failed requests once before showing error.
 *   Don't retry on 4xx errors (auth/validation) — only on network issues.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,      // 5 minutes
      gcTime: 1000 * 60 * 10,         // 10 minutes
      retry: (failureCount, error) => {
        // Don't retry on 401/403/404 — these are client errors
        if (error instanceof Error && 'status' in error) {
          const status = (error as { status: number }).status;
          if (status === 401 || status === 403 || status === 404) return false;
        }
        return failureCount < 1; // Retry once on other errors
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0, // Never retry mutations (could cause duplicate actions)
    },
  },
});
