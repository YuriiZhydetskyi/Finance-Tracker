import { useMutation, useQueryClient } from '@tanstack/react-query';
import { nowIso } from '@finance-tracker/domain';
import { supabase } from '@/shared/lib/supabase-client';
import { receiptsQueryKey, receiptQueryKey } from '@/features/receipts';
import { statsByCategoryQueryKey } from '@/features/stats';
import { wasteItemsQueryKey } from './use-waste-items';
import { wasteByMonthQueryKey } from '@/features/stats/api/use-stats';

export type UpdateItemWasteVars = {
  itemId: string;
  // Pre-rounded by caller (or just trust user input — domain factory does
  // 3dp rounding when full items are constructed; here we issue a partial
  // UPDATE, so the caller is responsible for sensible input).
  wastedQty: number;
  // Belongs to which receipt — used to invalidate the receipt detail cache.
  receiptId: string;
};

/**
 * Per-item targeted UPDATE — the ONLY mutation in the app that touches a
 * single row of `items` without going through the full delete+insert receipt
 * flow. RLS on items is already in place; nothing to add here.
 *
 * Invariant maintained: wasted_at is non-null iff wasted_qty > 0.
 * When wasted_qty > 0: timestamp is overwritten with now() each time.
 * When wasted_qty == 0: timestamp is nulled out.
 */
export function useUpdateItemWasteMutation() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, UpdateItemWasteVars>({
    mutationFn: async ({ itemId, wastedQty }) => {
      const wasted_at = wastedQty > 0 ? nowIso() : null;
      const { error } = await supabase
        .from('items')
        .update({ wasted_qty: wastedQty, wasted_at, updated_at: nowIso() })
        .eq('id', itemId);
      if (error) throw new Error(`Item waste update failed: ${error.message}`);
    },
    onSuccess: async (_result, { receiptId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: wasteItemsQueryKey }),
        queryClient.invalidateQueries({ queryKey: receiptsQueryKey }),
        queryClient.invalidateQueries({ queryKey: receiptQueryKey(receiptId) }),
        // Waste-by-month chart depends on this column; category chart already
        // uses total_eur (untouched), so we only invalidate it as a courtesy
        // for any future view that aggregates over wasted_qty.
        queryClient.invalidateQueries({ queryKey: wasteByMonthQueryKey }),
        queryClient.invalidateQueries({ queryKey: statsByCategoryQueryKey }),
      ]);
    },
  });
}
