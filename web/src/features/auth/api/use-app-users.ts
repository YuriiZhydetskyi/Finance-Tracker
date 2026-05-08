import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase-client';

export const appUsersQueryKey = ['auth', 'app_users'] as const;

/** Returns all allowlisted emails, ordered alphabetically. RLS-filtered. */
export function useAppUsers() {
  return useQuery<string[]>({
    queryKey: appUsersQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase.from('app_users').select('email').order('email');
      if (error) throw error;
      return data.map((row) => row.email);
    },
    staleTime: 5 * 60_000,
  });
}
