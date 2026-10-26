import { queryOptions, skipToken, useQuery } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase-client';
import { useCurrentUser } from './use-current-user';

export const allowlistQueryKey = (email: string | undefined) =>
  ['auth', 'allowlist', email ?? ''] as const;

export function allowlistQueryOptions(email: string | undefined) {
  return queryOptions({
    queryKey: allowlistQueryKey(email),
    queryFn: email
      ? async (): Promise<boolean> => {
          const { data, error } = await supabase
            .from('app_users')
            .select('email')
            .eq('email', email)
            .maybeSingle();
          if (error) throw error;
          return data !== null;
        }
      : skipToken,
    staleTime: 5 * 60_000,
  });
}

/**
 * Checks whether the current user's email is in `public.app_users`. RLS
 * policy `allowlist_read_app_users` returns every row to an allowlisted user
 * and zero rows otherwise, so a 1-row result means "allowed".
 */
export function useAllowlistCheck() {
  const { data: user } = useCurrentUser();
  return useQuery(allowlistQueryOptions(user?.email));
}
