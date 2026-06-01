import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase-client';

export type ProductDetail = {
  id: string;
  name: string;
  notes: string | null;
};

/** Full detail for one product (currently id/name/notes) for the Insights panel. */
export function useProductDetail(productId: string) {
  return useQuery<ProductDetail | null>({
    queryKey: ['product-detail', productId],
    enabled: productId.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, notes')
        .eq('id', productId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
