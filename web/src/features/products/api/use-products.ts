import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase-client';

export type ProductRow = {
  id: string;
  name: string;
  store: string;
  store_product_code: string | null;
  category: string;
  product_family_id: string | null;
  product_variant_id: string | null;
  brand: string | null;
  is_organic: boolean | null;
};

export const productsQueryKey = ['products'] as const;
export const productTaxonomyQueryKey = ['product-taxonomy'] as const;

export type ProductTaxonomy = {
  families: {
    id: string;
    name_uk: string;
    name_en: string;
    name_de: string;
  }[];
  variants: {
    id: string;
    family_id: string;
    name_uk: string;
    name_en: string;
    name_de: string;
  }[];
};

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
        .select(
          'id, name, store, store_product_code, category, product_family_id, product_variant_id, brand, is_organic',
        )
        .order('name');
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  });
}

/** Catalogue labels for manual review. Empty data is valid before the seed is applied. */
export function useProductTaxonomy() {
  return useQuery<ProductTaxonomy>({
    queryKey: productTaxonomyQueryKey,
    queryFn: async () => {
      const [families, variants] = await Promise.all([
        supabase.from('product_families').select('id, name_uk, name_en, name_de').order('name_uk'),
        supabase
          .from('product_variants')
          .select('id, family_id, name_uk, name_en, name_de')
          .order('name_uk'),
      ]);
      if (families.error) throw families.error;
      if (variants.error) throw variants.error;
      return { families: families.data ?? [], variants: variants.data ?? [] };
    },
    staleTime: 5 * 60_000,
  });
}
