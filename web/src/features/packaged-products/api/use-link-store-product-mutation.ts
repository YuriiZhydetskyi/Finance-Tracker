import { useMutation, useQueryClient } from '@tanstack/react-query';
import { productsQueryKey } from '@/features/products/api/use-products';
import { supabase } from '@/shared/lib/supabase-client';
import { wrapError } from '@/shared/utils/wrap-error';
import {
  packagedProductStoreLabelsQueryKey,
  packagedProductsQueryKey,
  packagingCandidatesQueryKey,
} from './packaged-products-query-keys';

function invalidateAll(
  queryClient: ReturnType<typeof useQueryClient>,
  packagedProductId: string | null,
): void {
  void queryClient.invalidateQueries({ queryKey: packagingCandidatesQueryKey });
  void queryClient.invalidateQueries({ queryKey: packagedProductsQueryKey });
  void queryClient.invalidateQueries({ queryKey: productsQueryKey });
  if (packagedProductId) {
    void queryClient.invalidateQueries({
      queryKey: packagedProductStoreLabelsQueryKey(packagedProductId),
    });
  }
}

export type LinkStoreProductVars = {
  productIds: string[];
  /** null unlinks, returning the labels to the photographing queue. */
  packagedProductId: string | null;
};

/**
 * Points store labels at a packaged product. Nothing else has to change: the
 * existing apply_product_match_rule trigger already routes future receipt lines
 * of that store to this products row, so they inherit the card for free.
 */
export function useLinkStoreProductMutation() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, LinkStoreProductVars>({
    mutationFn: async ({ productIds, packagedProductId }) => {
      if (productIds.length === 0) return;
      const { error } = await supabase
        .from('products')
        .update({ packaged_product_id: packagedProductId })
        .in('id', productIds);
      if (error) throw wrapError('Не вдалося змінити прив’язку позиції', error);
    },
    onSuccess: (_void, { packagedProductId }) => {
      invalidateAll(queryClient, packagedProductId);
    },
  });
}

export type SkipPackagingVars = {
  productIds: string[];
  /** false puts the labels back into the queue. */
  notApplicable: boolean;
};

/**
 * Loose produce, counter bread, services and Pfand never get a packaging photo.
 * Without this the queue is permanent noise and stops being a work list.
 */
export function useSkipPackagingMutation() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, SkipPackagingVars>({
    mutationFn: async ({ productIds, notApplicable }) => {
      if (productIds.length === 0) return;
      const { error } = await supabase
        .from('products')
        .update({ packaging_not_applicable: notApplicable })
        .in('id', productIds);
      if (error) throw wrapError('Не вдалося оновити позицію', error);
    },
    onSuccess: () => {
      invalidateAll(queryClient, null);
    },
  });
}
