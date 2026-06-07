import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  dedupOccurrences,
  makeStatementTransaction,
  type StatementTransactionInput,
} from '@finance-tracker/domain';
import { supabase } from '@/shared/lib/supabase-client';
import { wrapError } from '@/shared/utils/wrap-error';
import { statementTransactionsQueryKey } from './statement-transactions-query-keys';

/**
 * Persists orphan statement lines (those that matched no receipt on import).
 * Upserts on the unique `dedup_key` with `ignoreDuplicates` so re-importing the
 * same statement is a no-op for already-stored orphans — no duplicates, no error.
 * Inputs are turned into full rows by the domain factory (ULID, rounding,
 * dedup_key, status='unmatched').
 */
export function useSaveOrphansMutation() {
  const queryClient = useQueryClient();

  return useMutation<number, Error, StatementTransactionInput[]>({
    mutationFn: async (inputs) => {
      if (inputs.length === 0) return 0;
      // Disambiguate genuine same-import duplicates so both survive the unique-key
      // upsert (a re-import reproduces identical occurrences → still deduped).
      const occurrences = dedupOccurrences(
        inputs.map((i) => ({
          date: i.date,
          amount: i.amount_orig,
          currency: i.currency,
          merchant: i.merchant ?? null,
          raw: i.raw ?? null,
        })),
      );
      const rows = inputs.map((input, i) =>
        makeStatementTransaction({ ...input, occurrence: occurrences[i] }),
      );
      const { error } = await supabase
        .from('statement_transactions')
        .upsert(rows, { onConflict: 'dedup_key', ignoreDuplicates: true });
      if (error) throw wrapError('Не вдалося зберегти транзакції без чека', error);
      return rows.length;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: statementTransactionsQueryKey });
    },
  });
}
