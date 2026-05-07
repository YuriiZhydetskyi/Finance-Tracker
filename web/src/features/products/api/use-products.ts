import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase-client';

export type ProductRow = {
  id: string;
  name: string;
  category: string;
};

export const productsQueryKey = ['products'] as const;

/**
 * Lightweight product list for autocomplete. Returns id/name/category only —
 * unit/unit_size/notes loaded on demand if a future workflow needs them.
 * RLS-filtered.
 */
export function useProducts() {
  return useQuery<ProductRow[]>({
    queryKey: productsQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, category')
        .order('name');
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  });
}
