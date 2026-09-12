import { useMutation, useQueryClient } from '@tanstack/react-query';
import { productsQueryKey } from '@/features/products/api/use-products';
import { supabase } from '@/shared/lib/supabase-client';
import { packagingPhotoStorage } from '@/shared/lib/dependencies';
import { wrapError } from '@/shared/utils/wrap-error';
import {
  packagedProductQueryKey,
  packagedProductsQueryKey,
  packagingCandidatesQueryKey,
} from './packaged-products-query-keys';
import type { PackagedProductRow } from '../types';

/** Fields a person may correct by hand on the detail page. */
export type PackagedProductPatch = Partial<
  Pick<
    PackagedProductRow,
    | 'name'
    | 'brand'
    | 'barcode'
    | 'category'
    | 'product_family_id'
    | 'product_variant_id'
    | 'is_organic'
    | 'notes'
  >
>;

export function useUpdatePackagedProductMutation() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { id: string; patch: PackagedProductPatch }>({
    mutationFn: async ({ id, patch }) => {
      const { error } = await supabase.from('packaged_products').update(patch).eq('id', id);
      if (error) throw wrapError('Не вдалося оновити картку товару', error);
    },
    onSuccess: (_void, { id }) => {
      void queryClient.invalidateQueries({ queryKey: packagedProductQueryKey(id) });
      void queryClient.invalidateQueries({ queryKey: packagedProductsQueryKey });
    },
  });
}

/**
 * Deleting a card unlinks its store labels (`on delete set null`) rather than
 * cascading, so they return to the photographing queue. Storage objects are
 * removed best-effort after the rows are gone.
 */
export function useDeletePackagedProductMutation() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const { data: photos, error: readError } = await supabase
        .from('packaged_product_photos')
        .select('storage_path')
        .eq('packaged_product_id', id);
      if (readError) throw wrapError('Не вдалося прочитати фото картки', readError);

      const { error } = await supabase.from('packaged_products').delete().eq('id', id);
      if (error) throw wrapError('Не вдалося видалити картку товару', error);

      await Promise.all(
        (photos ?? []).map((photo) =>
          packagingPhotoStorage.remove(photo.storage_path).catch(() => {
            /* best-effort: rows are already gone, leftovers are swept separately */
          }),
        ),
      );
    },
    onSuccess: (_void, { id }) => {
      void queryClient.invalidateQueries({ queryKey: packagedProductQueryKey(id) });
      void queryClient.invalidateQueries({ queryKey: packagedProductsQueryKey });
      void queryClient.invalidateQueries({ queryKey: packagingCandidatesQueryKey });
      void queryClient.invalidateQueries({ queryKey: productsQueryKey });
    },
  });
}
