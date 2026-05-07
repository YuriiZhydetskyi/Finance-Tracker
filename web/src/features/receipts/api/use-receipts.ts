import { useQuery } from '@tanstack/react-query';
import type { Receipt } from '@finance-tracker/domain';
import { supabase } from '@/shared/lib/supabase-client';
import { receiptsQueryKey } from './receipts-query-keys';

const DEFAULT_LIMIT = 30;

/**
 * Returns the most recent receipts for the current user (RLS-filtered).
 * Sorted by date desc, then created_at desc to break ties stably.
 */
export function useReceipts(limit = DEFAULT_LIMIT) {
  return useQuery<Receipt[]>({
    queryKey: [...receiptsQueryKey, { limit }] as const,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('receipts')
        .select('*')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });
}
