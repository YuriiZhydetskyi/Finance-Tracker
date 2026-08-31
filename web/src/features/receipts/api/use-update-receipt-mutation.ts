import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  applyReceiptPatch,
  makeItem,
  makeProductPrice,
  type Receipt,
} from '@finance-tracker/domain';
import { supabase } from '@/shared/lib/supabase-client';
import { fxRateProvider } from '@/shared/lib/dependencies';
import { wrapError } from '@/shared/utils/wrap-error';
import { productsQueryKey } from '@/features/products/api/use-products';
import { computeGrandTotal } from '../utils/totals';
import { receiptQueryKey, receiptsQueryKey } from './receipts-query-keys';
import type { SaveItemInput, SaveReceiptInput } from './use-save-receipt-mutation';
import { resolveProducts } from './resolve-products';

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
 *   4. UPDATE receipts → DELETE existing items + product_prices for this
 *      receipt → INSERT new items + new product_prices snapshots.
 *      No DB transaction (Supabase JS doesn't expose them); failure between
 *      steps leaves a visible empty receipt — documented Studio cleanup path.
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
        note: receiptInput.note ?? null,
        time: receiptInput.time ?? null,
        source: 'edit',
        fx_rate_eur,
        total_orig,
      });

      const { data: existingProducts, error: fetchError } = await supabase
        .from('products')
        .select('id, name, store, store_product_code, category')
        .eq('store', patched.store);
      if (fetchError) throw wrapError('Products fetch failed', fetchError);

      const resolution = resolveProducts({
        store: patched.store,
        items: itemInputs.map((it) => ({
          product_name: it.product_name,
          store_product_code: it.store_product_code ?? null,
          category: it.category,
        })),
        existingProducts: existingProducts ?? [],
      });

      if (resolution.newProducts.length > 0) {
        const { error: productsError } = await supabase
          .from('products')
          .insert(resolution.newProducts);
        if (productsError) throw wrapError('Products insert failed', productsError);
      }

      for (const bf of resolution.backfills) {
        const { error: bfError } = await supabase
          .from('products')
          .update({ store_product_code: bf.store_product_code })
          .eq('id', bf.id);
        if (bfError) throw wrapError('Product backfill failed', bfError);
      }

      const newItems = itemInputs.map((it, idx) =>
        makeItem({
          ...it,
          receipt_id: id,
          product_id: resolution.productIdByIndex[idx] ?? null,
          fx_rate_eur,
        }),
      );

      const { error: updateError } = await supabase
        .from('receipts')
        .update({
          date: patched.date,
          store: patched.store,
          store_address: patched.store_address,
          currency: patched.currency,
          total_orig: patched.total_orig,
          fx_rate_eur: patched.fx_rate_eur,
          total_eur: patched.total_eur,
          paid_by: patched.paid_by,
          photo_url: patched.photo_url,
          photo_path: patched.photo_path,
          raw_ocr_json: patched.raw_ocr_json,
          note: patched.note,
          time: patched.time,
          source: patched.source,
          updated_at: patched.updated_at,
        })
        .eq('id', id);
      if (updateError) throw wrapError('Receipt update failed', updateError);

      // Wipe the receipt's old item + price snapshots before reinserting.
      // product_prices.receipt_id has ON DELETE CASCADE only via receipt
      // delete — for an UPDATE we have to scrub explicitly.
      const { error: deleteError } = await supabase.from('items').delete().eq('receipt_id', id);
      if (deleteError) throw wrapError('Items delete failed', deleteError);

      const { error: pricesDeleteError } = await supabase
        .from('product_prices')
        .delete()
        .eq('receipt_id', id);
      if (pricesDeleteError) throw wrapError('Price snapshots delete failed', pricesDeleteError);

      if (newItems.length > 0) {
        const { error: insertError } = await supabase.from('items').insert(newItems);
        if (insertError) throw wrapError('Items insert failed', insertError);
      }

      const prices = newItems
        .filter((it) => it.product_id != null)
        .map((it) =>
          makeProductPrice({
            product_id: it.product_id!,
            receipt_id: id,
            price_orig: it.unit_price_orig,
            price_net: it.unit_price_orig - it.discount_orig,
            currency: patched.currency,
            date: patched.date,
          }),
        );

      if (prices.length > 0) {
        const { error: pricesError } = await supabase.from('product_prices').insert(prices);
        if (pricesError) throw wrapError('Price snapshot insert failed', pricesError);
      }

      return { receipt_id: id, items_count: newItems.length };
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
