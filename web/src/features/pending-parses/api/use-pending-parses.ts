import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase-client';

export type PendingParseRow = {
  id: string;
  photo_path: string;
  paid_by: string;
  error_message: string | null;
  attempts: number;
  original_filename: string | null;
  created_at: string;
};

export const pendingParsesQueryKey = ['pending-parses'] as const;

/**
 * Photos whose AI parse failed and were persisted for a later retry, newest
 * first. RLS-filtered to the allowlisted user.
 */
export function usePendingParses() {
  return useQuery<PendingParseRow[]>({
    queryKey: pendingParsesQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pending_parses')
        .select('id, photo_path, paid_by, error_message, attempts, original_filename, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });
}
