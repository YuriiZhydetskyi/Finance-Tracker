import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase-client';
import { wrapError } from '@/shared/utils/wrap-error';
import { statementTransactionsQueryKey } from './statement-transactions-query-keys';

/**
 * Marks an orphan transaction as 'dismissed' — the user has decided it isn't
 * something to track (salary, transfer, cash withdrawal). It drops out of the
 * unmatched list but stays in the table so re-import can't resurrect it (the
 * dedup_key still collides).
 */
export function useDismissOrphanMutation() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('statement_transactions')
        .update({ status: 'dismissed' })
        .eq('id', id);
      if (error) throw wrapError('Не вдалося приховати транзакцію', error);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: statementTransactionsQueryKey });
    },
  });
}
