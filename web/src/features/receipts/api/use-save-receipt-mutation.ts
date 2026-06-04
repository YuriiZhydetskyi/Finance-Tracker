import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  makeItem,
  makeProductPrice,
  makeReceipt,
  type ItemInput,
  type ReceiptInput,
} from '@finance-tracker/domain';
import { supabase } from '@/shared/lib/supabase-client';
import { fxRateProvider } from '@/shared/lib/dependencies';
import { wrapError } from '@/shared/utils/wrap-error';
import { productsQueryKey } from '@/features/products/api/use-products';
import { computeGrandTotal } from '../utils/totals';
import { receiptsQueryKey } from './receipts-query-keys';
import { resolveProducts } from './resolve-products';

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
 *   2. Build Receipt via factory.
 *   3. Fetch existing products for receipt.store; resolve each item to a
 *      product_id (link / backfill code / create new). See resolve-products.ts.
 *   4. Insert NEW products (multi-row); UPDATE backfilled codes (per row).
 *   5. Build Items via factory with assigned product_id.
 *   6. Insert receipt → items (existing flow).
 *   7. Insert product_prices snapshots — one per item, both price_orig and
 *      price_net so trends survive store-side promotions.
 *
 * Rollback: if items insert fails, the receipt is deleted (cascades items +
 * prices on retry). Newly-created products stay; they're idempotent (next
 * save with the same key will reuse them) and the cost of orphans is low.
 * Price-snapshot insert failure also rolls back the receipt.
 */
export function useSaveReceiptMutation() {
  const queryClient = useQueryClient();

  return useMutation<SaveReceiptResult, Error, SaveReceiptVars>({
    mutationFn: async ({ receipt: receiptInput, items: itemInputs }) => {
      const fx_rate_eur = await fxRateProvider.getRateLive(
        receiptInput.currency,
        receiptInput.date,
      );

      const total_orig = computeGrandTotal(itemInputs);

      const receipt = makeReceipt({ ...receiptInput, fx_rate_eur, total_orig });

      const { data: existing, error: fetchError } = await supabase
        .from('products')
        .select('id, name, store, store_product_code, category')
        .eq('store', receipt.store);
      if (fetchError) throw wrapError('Products fetch failed', fetchError);

      const resolution = resolveProducts({
        store: receipt.store,
        items: itemInputs.map((it) => ({
          product_name: it.product_name,
          store_product_code: it.store_product_code ?? null,
          category: it.category,
        })),
        existingProducts: existing ?? [],
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

      const items = itemInputs.map((it, idx) =>
        makeItem({
          ...it,
          receipt_id: receipt.id,
          product_id: resolution.productIdByIndex[idx] ?? null,
          fx_rate_eur,
        }),
      );

      const { error: receiptError } = await supabase.from('receipts').insert(receipt);
      if (receiptError) throw wrapError('Receipt insert failed', receiptError);

      if (items.length > 0) {
        const { error: itemsError } = await supabase.from('items').insert(items);
        if (itemsError) {
          await supabase.from('receipts').delete().eq('id', receipt.id);
          throw wrapError('Items insert failed', itemsError);
        }
      }

      const prices = items
        .filter((it) => it.product_id != null)
        .map((it) =>
          makeProductPrice({
            product_id: it.product_id!,
            receipt_id: receipt.id,
            price_orig: it.unit_price_orig,
            price_net: it.unit_price_orig - it.discount_orig,
            currency: receipt.currency,
            date: receipt.date,
          }),
        );

      if (prices.length > 0) {
        const { error: pricesError } = await supabase.from('product_prices').insert(prices);
        if (pricesError) {
          await supabase.from('receipts').delete().eq('id', receipt.id);
          throw wrapError('Price snapshot insert failed', pricesError);
        }
      }

      return { receipt_id: receipt.id, items_count: items.length };
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: receiptsQueryKey }),
        queryClient.invalidateQueries({ queryKey: productsQueryKey }),
      ]);
    },
  });
}
