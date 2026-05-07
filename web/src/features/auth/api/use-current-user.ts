import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { authService, type AuthUser } from '@/shared/lib/dependencies';

export const currentUserQueryKey = ['auth', 'currentUser'] as const;

/**
 * Returns the current authenticated user, kept in sync with auth-state events
 * (sign-in, sign-out, token refresh) by mutating the React Query cache.
 */
export function useCurrentUser() {
  const queryClient = useQueryClient();

  useEffect(() => {
    return authService.onAuthStateChange((user) => {
      queryClient.setQueryData<AuthUser | null>(currentUserQueryKey, user);
    });
  }, [queryClient]);

  return useQuery<AuthUser | null>({
    queryKey: currentUserQueryKey,
    queryFn: () => authService.getCurrentUser(),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
