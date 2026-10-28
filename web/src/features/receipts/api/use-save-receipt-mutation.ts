import { useMutation, useQueryClient } from '@tanstack/react-query';
import { makeReceipt } from '@finance-tracker/domain';
import { fxRateProvider } from '@/shared/lib/dependencies';
import { computeGrandTotal } from '../utils/totals';
import { invalidateReceiptDerivedQueries } from './invalidate-receipt-derived-queries';
import {
  buildReceiptBundle,
  fetchCanonicalStoreName,
  fetchStoreProducts,
  saveReceiptBundle,
  type SaveItemInput,
  type SaveReceiptInput,
} from './receipt-bundle';

export type { SaveItemInput, SaveReceiptInput } from './receipt-bundle';

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
 *   3. Ask the database for the canonical spelling of receipt.store (ADR-0033),
 *      fetch the existing products of that store and resolve each item to a
 *      product_id (link / backfill code / create new). See resolve-products.ts.
 *   4. Build Items via factory with assigned product_id and a price-snapshot id.
 *
 * All writes (new products, backfills, enrichments, receipt, items, price
 * snapshots) go through the save_receipt_bundle RPC in one transaction, so a
 * failure leaves nothing behind.
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

      const store = await fetchCanonicalStoreName(receipt.store);
      const existingProducts = await fetchStoreProducts(store);

      const bundle = buildReceiptBundle({
        receipt_id: receipt.id,
        store,
        fx_rate_eur,
        items: itemInputs,
        existingProducts,
      });

      return saveReceiptBundle({ receipt: { ...receipt, store }, bundle, replace: false });
    },
    onSuccess: () => invalidateReceiptDerivedQueries(queryClient),
  });
}
