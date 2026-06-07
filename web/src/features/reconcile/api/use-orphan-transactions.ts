import { useQuery } from '@tanstack/react-query';
import type { StatementTransaction } from '@finance-tracker/domain';
import { supabase } from '@/shared/lib/supabase-client';
import { statementTransactionsQueryKey } from './statement-transactions-query-keys';

/**
 * Persisted orphan card transactions still awaiting resolution
 * (status='unmatched'), newest first. These survive across imports/reloads so a
 * later-entered receipt can be re-matched against them, or the user can turn one
 * into a stub receipt / dismiss it. RLS-filtered to the allowlisted user.
 */
export function useOrphanTransactions() {
  return useQuery<StatementTransaction[]>({
    queryKey: statementTransactionsQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('statement_transactions')
        .select('*')
        .eq('status', 'unmatched')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as StatementTransaction[];
    },
    staleTime: 30_000,
  });
}
