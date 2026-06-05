import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase-client';
import { wrapError } from '@/shared/utils/wrap-error';
import { receiptQueryKey, receiptsQueryKey } from '@/features/receipts';

export type ReassignPayerVars = { ids: string[]; paid_by: string };

/**
 * Lightweight `paid_by`-only correction for N receipts (statement reconciliation).
 * Deliberately does NOT touch items / product_prices like the heavy edit mutation —
 * the payer change is orthogonal to line items. `updated_at` is bumped by the DB
 * `set_updated_at()` trigger; `source` is left untouched (a correction, not a
 * re-entry).
 *
 * Invalidation runs in `onSettled` (not `onSuccess`) so a PARTIAL batch — some
 * updates land, one errors — still refreshes the cache for the rows that did
 * change; otherwise their flipped `paid_by` would stay stale in the UI. The
 * matcher is idempotent, so a re-run reconciles whatever didn't apply.
 */
export function useReassignPayerMutation() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, ReassignPayerVars>({
    mutationFn: async ({ ids, paid_by }) => {
      const results = await Promise.all(
        ids.map((id) => supabase.from('receipts').update({ paid_by }).eq('id', id)),
      );
      const errors = results.map((r) => r.error).filter((e) => e != null);
      if (errors.length > 0) {
        throw wrapError(
          `Не вдалося оновити платника (${errors.length} з ${ids.length})`,
          errors[0],
        );
      }
    },
    onSettled: async (_data, _error, { ids }) => {
      for (const id of ids) queryClient.removeQueries({ queryKey: receiptQueryKey(id) });
      await queryClient.invalidateQueries({ queryKey: receiptsQueryKey });
    },
  });
}
