import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase-client';
import type { ProductRow } from './use-products';

export const searchProductsQueryKey = (query: string, store: string) =>
  ['products', 'search', query, store] as const;

/**
 * Product search for the Insights page. Primary fuzzy match runs through the
 * `search_products` RPC (name + printed store code). When the user also picks a
 * store, we narrow with a single PostgREST or-filter so it stays one round-trip.
 */
export function useSearchProducts(query: string, store: string) {
  return useQuery<ProductRow[]>({
    queryKey: searchProductsQueryKey(query, store),
    enabled: query.trim().length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_products', { search: query });
      if (error) throw error;
      let rows: ProductRow[] = data ?? [];
      if (store) {
        const narrowed = await supabase
          .from('products')
          .select('id, name, store, store_product_code, category')
          .or(`store.eq.${store},name.ilike.*${query}*`);
        if (narrowed.error) throw narrowed.error;
        rows = narrowed.data ?? [];
      }
      return rows;
    },
    staleTime: 60_000,
  });
}
