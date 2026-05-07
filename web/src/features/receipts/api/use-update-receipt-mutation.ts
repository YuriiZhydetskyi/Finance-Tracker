import { useMutation, useQueryClient } from '@tanstack/react-query';
import { applyReceiptPatch, makeItem, type Receipt } from '@finance-tracker/domain';
import { supabase } from '@/shared/lib/supabase-client';
import { fxRateProvider } from '@/shared/lib/dependencies';
import { computeGrandTotal } from '../utils/totals';
import { receiptQueryKey, receiptsQueryKey } from './receipts-query-keys';
import type { SaveItemInput, SaveReceiptInput } from './use-save-receipt-mutation';

export type UpdateReceiptVars = {
  id: string;
  existing: Receipt;
  receipt: SaveReceiptInput;
  items: SaveItemInput[];
};

export type UpdateReceiptResult = {
  receipt_id: string;
  items_count: number;
};

/**
 * Update flow (mirrors legacy Web.updateReceipt semantics):
 *   1. Re-fetch FX rate ONLY if currency or date changed; otherwise keep
 *      the stored rate so an unrelated edit doesn't drift the audit trail.
 *   2. Recompute total_orig from items (sum of per-row rounded subtotals).
 *   3. applyReceiptPatch — recomputes total_eur, bumps updated_at, validates.
 *   4. Build new items via makeItem (fresh ULIDs, fresh timestamps).
 *   5. UPDATE receipts → DELETE items → INSERT items. No DB transaction
 *      (Supabase JS doesn't expose them); failure between steps leaves
 *      visible empty receipt — documented Studio cleanup path.
 *   6. Invalidate receipts list AND receipt(id) caches.
 *
 * source is forced to 'edit' to mark the receipt as user-modified.
 */
export function useUpdateReceiptMutation() {
  const queryClient = useQueryClient();

  return useMutation<UpdateReceiptResult, Error, UpdateReceiptVars>({
    mutationFn: async ({ id, existing, receipt: receiptInput, items: itemInputs }) => {
      const fxNeedsRefresh =
        receiptInput.currency !== existing.currency || receiptInput.date !== existing.date;
      const fx_rate_eur = fxNeedsRefresh
        ? await fxRateProvider.getRateLive(receiptInput.currency, receiptInput.date)
        : existing.fx_rate_eur;

      const total_orig = computeGrandTotal(itemInputs);

      const patched = applyReceiptPatch(existing, {
        date: receiptInput.date,
        store: receiptInput.store,
        currency: receiptInput.currency,
        paid_by: receiptInput.paid_by,
        photo_url: receiptInput.photo_url ?? null,
        raw_ocr_json: receiptInput.raw_ocr_json ?? null,
        note: receiptInput.note ?? null,
        source: 'edit',
        fx_rate_eur,
        total_orig,
      });

      const newItems = itemInputs.map((it) => makeItem({ ...it, receipt_id: id, fx_rate_eur }));

      const { error: updateError } = await supabase
        .from('receipts')
        .update({
          date: patched.date,
          store: patched.store,
          currency: patched.currency,
          total_orig: patched.total_orig,
          fx_rate_eur: patched.fx_rate_eur,
          total_eur: patched.total_eur,
          paid_by: patched.paid_by,
          photo_url: patched.photo_url,
          raw_ocr_json: patched.raw_ocr_json,
          note: patched.note,
          source: patched.source,
          updated_at: patched.updated_at,
        })
        .eq('id', id);
      if (updateError) throw new Error(`Receipt update failed: ${updateError.message}`);

      const { error: deleteError } = await supabase.from('items').delete().eq('receipt_id', id);
      if (deleteError) throw new Error(`Items delete failed: ${deleteError.message}`);

      if (newItems.length > 0) {
        const { error: insertError } = await supabase.from('items').insert(newItems);
        if (insertError) throw new Error(`Items insert failed: ${insertError.message}`);
      }

      return { receipt_id: id, items_count: newItems.length };
    },
    onSuccess: async (_result, { id }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: receiptsQueryKey }),
        queryClient.invalidateQueries({ queryKey: receiptQueryKey(id) }),
      ]);
    },
  });
}
