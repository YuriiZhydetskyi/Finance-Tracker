import { useMutation, useQueryClient } from '@tanstack/react-query';
import { applyReceiptPatch, type Receipt } from '@finance-tracker/domain';
import { fxRateProvider } from '@/shared/lib/dependencies';
import { productsQueryKey } from '@/features/products/api/use-products';
import { computeGrandTotal } from '../utils/totals';
import { receiptQueryKey, receiptsQueryKey } from './receipts-query-keys';
import {
  buildReceiptBundle,
  fetchStoreProducts,
  saveReceiptBundle,
  type SaveItemInput,
  type SaveReceiptInput,
} from './receipt-bundle';

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
 *   1. Re-fetch FX rate ONLY if currency or date changed.
 *   2. Recompute total_orig + apply patch.
 *   3. Resolve products for the new items (fresh link / backfill / create);
 *      reusing the same logic as save makes editing the store name auto-create
 *      the right products.
 *   4. Replace the receipt, its items and price snapshots through the
 *      save_receipt_bundle RPC (p_replace = true) in one transaction; a failure
 *      keeps the previous version intact.
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
        store_address: receiptInput.store_address ?? null,
        currency: receiptInput.currency,
        paid_by: receiptInput.paid_by,
        photo_url: receiptInput.photo_url ?? null,
        photo_path: receiptInput.photo_path ?? null,
        raw_ocr_json: receiptInput.raw_ocr_json ?? null,
        merchant_order_id: receiptInput.merchant_order_id ?? null,
        note: receiptInput.note ?? null,
        time: receiptInput.time ?? null,
        source: 'edit',
        fx_rate_eur,
        total_orig,
      });

      const existingProducts = await fetchStoreProducts(patched.store);

      const bundle = buildReceiptBundle({
        receipt_id: id,
        store: patched.store,
        fx_rate_eur,
        items: itemInputs,
        existingProducts,
      });

      return saveReceiptBundle({ receipt: { ...patched, id }, bundle, replace: true });
    },
    onSuccess: async (_result, { id }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: receiptsQueryKey }),
        queryClient.invalidateQueries({ queryKey: receiptQueryKey(id) }),
        queryClient.invalidateQueries({ queryKey: productsQueryKey }),
      ]);
    },
  });
}
