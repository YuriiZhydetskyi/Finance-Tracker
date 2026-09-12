import type {
  EuAllergen,
  NutriScore,
  NutritionBasis,
  PackagedProductImportSource,
  PackagedProductPhotoKind,
} from '@finance-tracker/domain';

/** One row of `public.packaged_products`, as PostgREST returns it. */
export type PackagedProductRow = {
  id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  category: string;
  product_family_id: string | null;
  product_variant_id: string | null;
  is_organic: boolean | null;
  package_size: number | null;
  package_unit: 'pcs' | 'g' | 'kg' | 'ml' | 'l' | null;
  package_count: number | null;
  serving_size: number | null;
  nutrition_basis: NutritionBasis | null;
  energy_kj: number | null;
  energy_kcal: number | null;
  fat_g: number | null;
  saturated_fat_g: number | null;
  carbohydrate_g: number | null;
  sugars_g: number | null;
  fibre_g: number | null;
  protein_g: number | null;
  salt_g: number | null;
  nutri_score: NutriScore | null;
  allergens: EuAllergen[];
  allergen_traces: EuAllergen[];
  ingredients_text: string | null;
  notes: string | null;
  import_source: PackagedProductImportSource;
  created_at: string;
  updated_at: string;
};

export type PackagedProductPhotoRow = {
  id: string;
  packaged_product_id: string;
  storage_path: string;
  kind: PackagedProductPhotoKind;
  content_type: string | null;
  byte_size: number | null;
  sort_order: number;
  note: string | null;
  created_at: string;
};

/** One row of `public.search_packaging_candidates(...)` — a store label with no card yet. */
export type PackagingCandidateRow = {
  product_id: string;
  product_name: string;
  store: string;
  store_product_code: string | null;
  category: string;
  brand: string | null;
  is_organic: boolean | null;
  product_family_id: string | null;
  product_variant_id: string | null;
  /** Verbatim labels printed on the receipts, which is what makes it recognisable. */
  receipt_labels: string[];
  purchases_count: number;
  total_qty: number;
  total_eur: number;
  last_purchased_on: string | null;
  last_price_orig: number | null;
  last_currency: string | null;
  /** Normalized brand+name; rows sharing it are one thing to photograph. */
  group_key: string;
  group_purchases_count: number;
};

/** One row of `public.packaged_product_store_labels(...)`. */
export type PackagedProductStoreLabelRow = {
  product_id: string;
  store: string;
  product_name: string;
  store_product_code: string | null;
  receipt_labels: string[];
  purchases_count: number;
  first_purchased_on: string | null;
  last_purchased_on: string | null;
  last_price_orig: number | null;
  last_price_net: number | null;
  last_currency: string | null;
};
