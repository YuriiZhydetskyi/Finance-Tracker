import { QueryClient } from '@tanstack/react-query';

// Single QueryClient instance shared across the app.
// Tweaks:
//   - staleTime 60s: don't refetch on every component remount within a minute.
//   - gcTime 5min: keep cache around so back-navigation is instant.
//   - retry: false on 401/403 (RLS / auth errors) — retrying never helps,
//     just delays the redirect to sign-in.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        const status = (error as { status?: number } | null)?.status;
        if (status === 401 || status === 403) return false;
        return failureCount < 2;
      },
    },
  },
});
