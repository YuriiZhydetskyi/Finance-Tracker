import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase-client';
import { wrapError } from '@/shared/utils/wrap-error';
import { statementTransactionsQueryKey } from './statement-transactions-query-keys';
import type { ResolveOrphanVars } from './use-resolve-orphan-mutation';

/**
 * Bulk variant of useResolveOrphanMutation for the "Зв'язати вибрані" action.
 * Per-row updates (receipt_id differs per orphan, so a single `.in()` update is
 * impossible) with an aggregated error, mirroring useReassignPayerMutation.
 * Invalidation runs in `onSettled` so a partial batch still refreshes the list.
 */
export function useResolveOrphansMutation() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, ResolveOrphanVars[]>({
    mutationFn: async (vars) => {
      if (vars.length === 0) return;
      const results = await Promise.all(
        vars.map(({ id, receipt_id }) =>
          supabase
            .from('statement_transactions')
            .update({ status: 'receipt_created', receipt_id })
            .eq('id', id),
        ),
      );
      const errors = results.map((r) => r.error).filter((e) => e != null);
      if (errors.length > 0) {
        throw wrapError(
          `Не вдалося зв'язати транзакції (${errors.length} з ${vars.length})`,
          errors[0],
        );
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: statementTransactionsQueryKey });
    },
  });
}
