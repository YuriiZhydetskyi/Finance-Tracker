import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  PRODUCT_ATTRIBUTES_SCHEMA,
  normalizeAttributes,
  type ProductAttributes,
} from '@finance-tracker/domain';
import { supabase } from '@/shared/lib/supabase-client';
import { wrapError } from '@/shared/utils/wrap-error';
import { packagedProductQueryKey, packagedProductsQueryKey } from './packaged-products-query-keys';

/**
 * Replaces the whole «Інше» object of one card. Adding, changing and removing a
 * pair are all just writing the object as it should be afterwards.
 */
export function useUpdateAttributesMutation() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { id: string; attributes: ProductAttributes }>({
    mutationFn: async ({ id, attributes }) => {
      const parsed = PRODUCT_ATTRIBUTES_SCHEMA.safeParse(normalizeAttributes(attributes));
      if (!parsed.success) {
        throw new Error(
          'Назва може мати до 60 символів, значення — до 300, а на картці їх не більше 30.',
        );
      }
      const { error } = await supabase
        .from('packaged_products')
        .update({ attributes: parsed.data })
        .eq('id', id);
      if (error) throw wrapError('Не вдалося оновити розділ «Інше»', error);
    },
    onSuccess: (_void, { id }) => {
      void queryClient.invalidateQueries({ queryKey: packagedProductsQueryKey });
      // Returned, so the mutation stays pending until the card is re-read: the next
      // click is then never computed from a stale object that still has a removed pair.
      return queryClient.invalidateQueries({ queryKey: packagedProductQueryKey(id) });
    },
  });
}
