import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase-client';
import { useCurrentUser } from './use-current-user';

/**
 * Checks whether the current user's email is in `public.app_users`. RLS
 * policy `self_read_app_users` allows each user to read their own row only,
 * so a 1-row result means "allowed", 0 rows means "not allowed".
 */
export function useAllowlistCheck() {
  const { data: user } = useCurrentUser();
  return useQuery<boolean>({
    queryKey: ['auth', 'allowlist', user?.email ?? ''],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return false;
      const { data, error } = await supabase
        .from('app_users')
        .select('email')
        .eq('email', user.email)
        .maybeSingle();
      if (error) throw error;
      return data !== null;
    },
    staleTime: 5 * 60_000,
  });
}
