import { useQuery } from '@tanstack/react-query';
import type { Receipt } from '@finance-tracker/domain';
import { supabase } from '@/shared/lib/supabase-client';
import { receiptsQueryKey } from './receipts-query-keys';

const DEFAULT_LIMIT = 30;

export type ReceiptFilters = {
  store?: string; // ILIKE %store% on receipts.store
  dateFrom?: string; // YYYY-MM-DD, inclusive lower bound on date
  dateTo?: string; // YYYY-MM-DD, inclusive upper bound on date
  paidBy?: string; // exact match on paid_by
  amountMin?: number; // inclusive lower bound on total_eur
  amountMax?: number; // inclusive upper bound on total_eur
};

/**
 * Returns receipts for the current user (RLS-filtered), narrowed by optional
 * filters and sorted by date desc + created_at desc to break ties stably.
 *
 * QueryKey includes filters so each filter combo caches independently;
 * mutations invalidate the `receiptsQueryKey` prefix to drop all variants.
 */
export function useReceipts(filters?: ReceiptFilters, limit = DEFAULT_LIMIT) {
  return useQuery<Receipt[]>({
    queryKey: [...receiptsQueryKey, { filters, limit }] as const,
    queryFn: async () => {
      let q = supabase.from('receipts').select('*');
      if (filters?.store) q = q.ilike('store', `%${filters.store}%`);
      if (filters?.dateFrom) q = q.gte('date', filters.dateFrom);
      if (filters?.dateTo) q = q.lte('date', filters.dateTo);
      if (filters?.paidBy) q = q.eq('paid_by', filters.paidBy);
      if (filters?.amountMin != null) q = q.gte('total_eur', filters.amountMin);
      if (filters?.amountMax != null) q = q.lte('total_eur', filters.amountMax);
      const { data, error } = await q
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });
}
