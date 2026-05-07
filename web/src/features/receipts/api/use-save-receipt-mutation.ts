import { useMutation, useQueryClient } from '@tanstack/react-query';
import { makeItem, makeReceipt, type ItemInput, type ReceiptInput } from '@finance-tracker/domain';
import { supabase } from '@/shared/lib/supabase-client';
import { fxRateProvider } from '@/shared/lib/dependencies';
import { receiptsQueryKey } from './receipts-query-keys';

// What the caller provides — derived fields (fx_rate_eur, total_orig, total_eur,
// receipt_id, ids, timestamps) are computed inside this mutation. Keeping
// total_orig out of the input avoids drift between form-computed and
// mutation-computed sums; the mutation is the single source of truth.
export type SaveReceiptInput = Omit<ReceiptInput, 'fx_rate_eur' | 'total_orig'>;
export type SaveItemInput = Omit<ItemInput, 'fx_rate_eur' | 'receipt_id'>;

export type SaveReceiptVars = {
  receipt: SaveReceiptInput;
  items: SaveItemInput[];
};

export type SaveReceiptResult = {
  receipt_id: string;
  items_count: number;
};

/**
 * Save flow:
 *   1. Fetch FX rate (live NBU for UAH; 1.0 for EUR).
 *   2. Build Receipt via factory (assigns id, computes total_eur, validates).
 *   3. Build Items via factory (each gets receipt_id + same fx_rate_eur).
 *   4. Insert receipt → if it fails, throw; nothing partial.
 *   5. Insert items → on failure, best-effort delete the receipt
 *      (RLS allows the user to delete their own row; cascade keeps cleanup tight).
 *   6. Invalidate receipts list.
 *
 * No transaction — Supabase JS client doesn't expose them. The rollback path
 * keeps orphans rare. If both insert AND rollback fail, we surface the original
 * error; the orphan can be cleaned up via Studio.
 */
export function useSaveReceiptMutation() {
  const queryClient = useQueryClient();

  return useMutation<SaveReceiptResult, Error, SaveReceiptVars>({
    mutationFn: async ({ receipt: receiptInput, items: itemInputs }) => {
      const fx_rate_eur = await fxRateProvider.getRateLive(
        receiptInput.currency,
        receiptInput.date,
      );

      const total_orig = itemInputs.reduce(
        (acc, it) => acc + it.qty * (it.unit_price_orig - (it.discount_orig ?? 0)),
        0,
      );

      const receipt = makeReceipt({ ...receiptInput, fx_rate_eur, total_orig });
      const items = itemInputs.map((it) =>
        makeItem({ ...it, receipt_id: receipt.id, fx_rate_eur }),
      );

      const { error: receiptError } = await supabase.from('receipts').insert(receipt);
      if (receiptError) throw new Error(`Receipt insert failed: ${receiptError.message}`);

      if (items.length > 0) {
        const { error: itemsError } = await supabase.from('items').insert(items);
        if (itemsError) {
          await supabase.from('receipts').delete().eq('id', receipt.id);
          throw new Error(`Items insert failed: ${itemsError.message}`);
        }
      }

      return { receipt_id: receipt.id, items_count: items.length };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: receiptsQueryKey });
    },
  });
}
