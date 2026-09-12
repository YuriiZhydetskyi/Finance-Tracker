import { useQuery } from '@tanstack/react-query';
import {
  normalizeNutriScore,
  PACKAGED_PRODUCT_IMPORT_SOURCES,
  type PackagedProductImportSource,
} from '@finance-tracker/domain';
import { supabase } from '@/shared/lib/supabase-client';
import { packagedProductQueryKey, packagedProductsQueryKey } from './packaged-products-query-keys';
import type { PackagedProductRow } from '../types';

const FIVE_MIN = 5 * 60_000;

// One string literal, not a concatenation: PostgREST's generated types only parse
// the column list when it is a literal type, and `raw_import_json` is deliberately
// left out — it is an audit payload, not something any screen renders.
// prettier-ignore
const ROW_COLUMNS = 'id, name, brand, barcode, category, product_family_id, product_variant_id, is_organic, package_size, package_unit, package_count, serving_size, nutrition_basis, energy_kj, energy_kcal, fat_g, saturated_fat_g, carbohydrate_g, sugars_g, fibre_g, protein_g, salt_g, nutri_score, allergens, allergen_traces, ingredients_text, notes, import_source, created_at, updated_at';

export type PackagedProductListRow = PackagedProductRow & {
  photos_count: number;
  store_labels_count: number;
};

function embeddedCount(value: { count: number }[] | null): number {
  return value?.[0]?.count ?? 0;
}

// `nutri_score` and `import_source` are text + CHECK in Postgres, so the generated
// types widen them to `string`. Narrow once here rather than casting at each use.
function toImportSource(value: string): PackagedProductImportSource {
  return (PACKAGED_PRODUCT_IMPORT_SOURCES as readonly string[]).includes(value)
    ? (value as PackagedProductImportSource)
    : 'manual';
}

function narrowRow<T extends { nutri_score: string | null; import_source: string }>(
  row: T,
): Omit<T, 'nutri_score' | 'import_source'> &
  Pick<PackagedProductRow, 'nutri_score' | 'import_source'> {
  return {
    ...row,
    nutri_score: row.nutri_score == null ? null : normalizeNutriScore(row.nutri_score),
    import_source: toImportSource(row.import_source),
  };
}

/**
 * The whole catalogue. Small enough (hundreds of rows) to filter in the browser,
 * and the same list backs the duplicate-barcode guard in the import dialog, so it
 * is deliberately not paginated.
 */
export function usePackagedProducts() {
  return useQuery<PackagedProductListRow[]>({
    queryKey: packagedProductsQueryKey,
    staleTime: FIVE_MIN,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('packaged_products')
        .select(`${ROW_COLUMNS}, packaged_product_photos(count), products(count)`)
        .order('name');
      if (error) throw error;
      return data.map((row) => {
        const { packaged_product_photos, products, ...rest } = row;
        return {
          ...narrowRow(rest),
          photos_count: embeddedCount(packaged_product_photos),
          store_labels_count: embeddedCount(products),
        };
      });
    },
  });
}

export function usePackagedProduct(id: string) {
  return useQuery<PackagedProductRow>({
    queryKey: packagedProductQueryKey(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('packaged_products')
        .select(ROW_COLUMNS)
        .eq('id', id)
        .single();
      if (error) throw error;
      return narrowRow(data);
    },
  });
}
