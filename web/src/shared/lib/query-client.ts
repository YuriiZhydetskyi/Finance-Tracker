import { QueryClient } from '@tanstack/react-query';

// Single QueryClient instance shared across the app.
// Tweaks:
//   - staleTime 60s: don't refetch on every component remount within a minute.
//   - gcTime 5min: keep cache around so back-navigation is instant.
//   - retry: false on auth errors (HTTP 401/403, RLS denial, bad JWT) —
//     retrying never helps, just delays the redirect to sign-in.

// PostgrestError carries no HTTP status, only a Postgres/PostgREST code.
function isAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { status, code } = error as { status?: unknown; code?: unknown };
  if (status === 401 || status === 403) return true; // FunctionsHttpError / fetch
  return code === '42501' || code === 'PGRST301' || code === 'PGRST302'; // RLS / JWT
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (isAuthError(error)) return false;
        return failureCount < 2;
      },
    },
  },
});
