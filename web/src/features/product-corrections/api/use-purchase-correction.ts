import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ulid } from '@finance-tracker/domain';
import { productsQueryKey, productTaxonomyQueryKey } from '@/features/products/api/use-products';
import { receiptQueryKey, receiptsQueryKey } from '@/features/receipts/api/receipts-query-keys';
import { wasteItemsQueryKey } from '@/features/waste';
import { supabase } from '@/shared/lib/supabase-client';
import { wrapError } from '@/shared/utils/wrap-error';

export type CorrectablePurchase = {
  id: string;
  receipt_id: string;
  product_id: string | null;
  product_name: string;
  raw_product_name: string;
  category: string;
  product_family_id: string | null;
  product_variant_id: string | null;
  receipt: { store: string; date: string; time: string | null };
};

export type PurchaseCorrectionVars = {
  itemId: string;
  receiptId: string;
  productName: string;
  category: string;
  productFamilyId: string | null;
  productVariantId: string | null;
  rememberRule: boolean;
};

export const purchaseCorrectionQueryKey = (itemId: string) =>
  ['purchase-correction', itemId] as const;

/** Loads only the purchase identity used by the correction dialog. */
export function useCorrectablePurchase(itemId: string) {
  return useQuery<CorrectablePurchase | null>({
    queryKey: purchaseCorrectionQueryKey(itemId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('items')
        .select(
          'id, receipt_id, product_id, product_name, raw_product_name, category, product_family_id, product_variant_id, receipt:receipts!inner(store, date, time)',
        )
        .eq('id', itemId)
        .maybeSingle();
      if (error) throw wrapError('Purchase correction fetch failed', error);
      return data ?? null;
    },
  });
}

export function usePurchaseCorrectionMutation() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, PurchaseCorrectionVars>({
    mutationFn: async (vars) => {
      const { error } = await supabase.rpc('correct_purchase_classification', {
        p_item_id: vars.itemId,
        // Always mint an id. The RPC reuses only an exact matching local
        // product and otherwise creates this new identity; it never mutates a
        // previously linked catalogue product as a side effect.
        p_product_id: ulid(),
        p_product_name: vars.productName.trim(),
        p_category: vars.category,
        p_remember_rule: vars.rememberRule,
        ...(vars.productFamilyId === null ? {} : { p_product_family_id: vars.productFamilyId }),
        ...(vars.productVariantId === null ? {} : { p_product_variant_id: vars.productVariantId }),
      });
      if (error) throw wrapError('Purchase correction failed', error);
    },
    onSuccess: async (_result, vars) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: purchaseCorrectionQueryKey(vars.itemId) }),
        queryClient.invalidateQueries({ queryKey: receiptQueryKey(vars.receiptId) }),
        queryClient.invalidateQueries({ queryKey: receiptsQueryKey }),
        queryClient.invalidateQueries({ queryKey: productsQueryKey }),
        queryClient.invalidateQueries({ queryKey: productTaxonomyQueryKey }),
        queryClient.invalidateQueries({ queryKey: wasteItemsQueryKey }),
        queryClient.invalidateQueries({ queryKey: ['stats'] }),
      ]);
    },
  });
}
