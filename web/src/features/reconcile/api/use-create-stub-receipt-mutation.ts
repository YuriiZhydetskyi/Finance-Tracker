import { useMutation, useQueryClient } from '@tanstack/react-query';
import { makeItem, makeReceipt } from '@finance-tracker/domain';
import { supabase } from '@/shared/lib/supabase-client';
import { fxRateProvider } from '@/shared/lib/dependencies';
import { wrapError } from '@/shared/utils/wrap-error';
import { receiptsQueryKey } from '@/features/receipts';

export type CreateStubReceiptVars = {
  date: string;
  store: string;
  currency: string;
  paid_by: string;
  time: string | null;
  amount_orig: number;
  category: string;
  consumed_by: string;
};

export type CreateStubReceiptResult = { receipt_id: string };

/**
 * Creates a detail-less "stub" receipt from an orphan card transaction (e.g. a
 * McDonald's charge whose receipt was never photographed): one catch-all line on
 * the full amount, so it shows up in EVERY stats view (v_stats_by_category
 * aggregates items, so a line is required).
 *
 * Unlike the full save flow (use-save-receipt-mutation), this deliberately does
 * NOT resolve/create a product or write a product_prices snapshot — a stub has no
 * real product detail, and inventing a store-named pseudo-product would pollute
 * the products list and price trends. The item is stored with product_id = null.
 */
export function useCreateStubReceiptMutation() {
  const queryClient = useQueryClient();

  return useMutation<CreateStubReceiptResult, Error, CreateStubReceiptVars>({
    mutationFn: async (vars) => {
      const fx_rate_eur = await fxRateProvider.getRateLive(vars.currency, vars.date);

      const receipt = makeReceipt({
        date: vars.date,
        store: vars.store,
        currency: vars.currency,
        paid_by: vars.paid_by,
        source: 'statement',
        time: vars.time,
        note: 'Створено з виписки (без деталей)',
        fx_rate_eur,
        total_orig: vars.amount_orig,
      });

      const item = makeItem({
        receipt_id: receipt.id,
        product_id: null,
        product_name: vars.store,
        category: vars.category,
        qty: 1,
        unit_price_orig: vars.amount_orig,
        consumed_by: vars.consumed_by,
        fx_rate_eur,
      });

      const { error: receiptError } = await supabase.from('receipts').insert(receipt);
      if (receiptError) throw wrapError('Не вдалося зберегти чек', receiptError);

      const { error: itemError } = await supabase.from('items').insert(item);
      if (itemError) {
        await supabase.from('receipts').delete().eq('id', receipt.id);
        throw wrapError('Не вдалося зберегти позицію чека', itemError);
      }

      return { receipt_id: receipt.id };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: receiptsQueryKey });
    },
  });
}
