import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { authService, type AuthUser } from '@/shared/lib/dependencies';

export const currentUserQueryKey = ['auth', 'currentUser'] as const;

/**
 * Drops every cached query and mutation, then re-seeds the current user. Used when
 * the signed-in identity ends or changes, so one session's private data can never
 * be shown to the next.
 *
 * The user is written before and after `clear()`: the first write tells mounted
 * observers (header, route guard) the new value, and `clear()` detaches them from
 * their cache entries without a notification, so the second write gives them a
 * settled entry to rebind to on their next render instead of a loading flash.
 */
export function resetCacheForUser(queryClient: QueryClient, user: AuthUser | null) {
  queryClient.setQueryData(currentUserQueryKey, user);
  queryClient.clear();
  queryClient.setQueryData(currentUserQueryKey, user);
}

type AuthSubscription = { refCount: number; unsubscribe: () => void };

const subscriptions = new WeakMap<QueryClient, AuthSubscription>();

/**
 * One auth listener per QueryClient, shared by every `useCurrentUser` caller. The
 * adapter replays the stored session to a new subscriber, so the cache is seeded
 * without a network round trip, and later events (sign-in, sign-out, token
 * refresh) keep it current.
 */
function retainAuthSubscription(queryClient: QueryClient): () => void {
  let subscription = subscriptions.get(queryClient);
  if (!subscription) {
    // undefined until the first event, which only establishes who is signed in.
    let knownEmail: string | null | undefined;
    const unsubscribe = authService.onAuthStateChange((user) => {
      const email = user?.email ?? null;
      const identityChanged = knownEmail !== undefined && knownEmail !== email;
      knownEmail = email;
      if (identityChanged) resetCacheForUser(queryClient, user);
      else queryClient.setQueryData<AuthUser | null>(currentUserQueryKey, user);
    });
    subscription = { refCount: 0, unsubscribe };
    subscriptions.set(queryClient, subscription);
  }

  const retained = subscription;
  retained.refCount += 1;
  return () => {
    retained.refCount -= 1;
    if (retained.refCount === 0) {
      retained.unsubscribe();
      subscriptions.delete(queryClient);
    }
  };
}

/**
 * Returns the current authenticated user, kept in sync with auth-state events
 * (sign-in, sign-out, token refresh) by mutating the React Query cache.
 */
export function useCurrentUser() {
  const queryClient = useQueryClient();

  useEffect(() => retainAuthSubscription(queryClient), [queryClient]);

  return useQuery<AuthUser | null>({
    queryKey: currentUserQueryKey,
    queryFn: () => authService.getCurrentUser(),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
