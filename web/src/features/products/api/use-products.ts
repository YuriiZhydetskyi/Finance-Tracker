import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase-client';

export type ProductRow = {
  id: string;
  name: string;
  store: string;
  store_product_code: string | null;
  category: string;
};

export const productsQueryKey = ['products'] as const;

/**
 * Lightweight product list for autocomplete + save-time linking.
 * Returns id/name/store/store_product_code/category — store fields drive
 * the (name, store) match logic in the receipt save mutation. RLS-filtered.
 */
export function useProducts() {
  return useQuery<ProductRow[]>({
    queryKey: productsQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, store, store_product_code, category')
        .order('name');
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  });
}
