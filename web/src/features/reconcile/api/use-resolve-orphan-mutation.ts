import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase-client';
import { wrapError } from '@/shared/utils/wrap-error';
import { statementTransactionsQueryKey } from './statement-transactions-query-keys';

export type ResolveOrphanVars = { id: string; receipt_id: string };

/**
 * Links an orphan to the receipt that now accounts for it (a stub the user just
 * created, or a real receipt entered later) and marks it 'receipt_created'. The
 * orphan leaves the unmatched list; the dedup_key stays so re-import is a no-op.
 */
export function useResolveOrphanMutation() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, ResolveOrphanVars>({
    mutationFn: async ({ id, receipt_id }) => {
      const { error } = await supabase
        .from('statement_transactions')
        .update({ status: 'receipt_created', receipt_id })
        .eq('id', id);
      if (error) throw wrapError('Не вдалося позначити транзакцію як оброблену', error);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: statementTransactionsQueryKey });
    },
  });
}
