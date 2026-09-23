import {
  makeItem,
  ulid,
  type Item,
  type ItemInput,
  type ProductInput,
  type Receipt,
  type ReceiptInput,
} from '@finance-tracker/domain';
import { supabase } from '@/shared/lib/supabase-client';
import { wrapError } from '@/shared/utils/wrap-error';
import type { ProductRow } from '@/features/products/api/use-products';
import { resolveProducts, type ItemKey, type ResolveProductsResult } from './resolve-products';

// What the caller provides — derived fields (fx_rate_eur, total_orig, total_eur,
// receipt_id, ids, timestamps) are computed inside the mutations. Keeping
// total_orig out of the input avoids drift between form-computed and
// mutation-computed sums; the mutation is the single source of truth.
export type SaveReceiptInput = Omit<ReceiptInput, 'fx_rate_eur' | 'total_orig'>;
export type SaveItemInput = Omit<ItemInput, 'fx_rate_eur' | 'receipt_id'> &
  Pick<ProductInput, 'brand' | 'is_organic'> & {
    /** Set by the review form only after a person changes product metadata. */
    product_metadata_override?: boolean;
  };

export type BundleItem = Item & { price_id: string };

export type ReceiptBundle = {
  items: BundleItem[];
  newProducts: ResolveProductsResult['newProducts'];
  backfills: ResolveProductsResult['backfills'];
  enrichments: ResolveProductsResult['enrichments'];
};

const PRODUCT_COLUMNS =
  'id, name, store, store_product_code, category, product_family_id, product_variant_id, brand, is_organic';

export async function fetchStoreProducts(store: string): Promise<ProductRow[]> {
  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_COLUMNS)
    .eq('store', store);
  if (error) throw wrapError('Products fetch failed', error);
  return data ?? [];
}

export function toItemKey(it: SaveItemInput): ItemKey {
  return {
    product_name: it.product_name,
    store_product_code: it.store_product_code ?? null,
    category: it.category,
    product_family_id: it.product_family_id ?? null,
    product_variant_id: it.product_variant_id ?? null,
    brand: it.brand ?? null,
    is_organic: it.is_organic ?? null,
    product_metadata_override: it.product_metadata_override ?? false,
  };
}

export function buildReceiptBundle(args: {
  receipt_id: string;
  store: string;
  fx_rate_eur: number;
  items: SaveItemInput[];
  existingProducts: ProductRow[];
}): ReceiptBundle {
  const resolution = resolveProducts({
    store: args.store,
    items: args.items.map(toItemKey),
    existingProducts: args.existingProducts,
  });
  const items = args.items.map((it, idx) => ({
    ...makeItem({
      ...it,
      receipt_id: args.receipt_id,
      product_id: resolution.productIdByIndex[idx] ?? null,
      fx_rate_eur: args.fx_rate_eur,
    }),
    price_id: ulid(),
  }));
  return {
    items,
    newProducts: resolution.newProducts,
    backfills: resolution.backfills,
    enrichments: resolution.enrichments,
  };
}

function readItemsCount(data: unknown): number | null {
  if (typeof data !== 'object' || data === null || !('items_count' in data)) return null;
  const raw = data.items_count;
  const value = typeof raw === 'string' ? Number(raw) : raw;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function saveReceiptBundle(args: {
  receipt: Receipt;
  bundle: ReceiptBundle;
  replace: boolean;
}): Promise<{ receipt_id: string; items_count: number }> {
  const { data, error } = await supabase.rpc('save_receipt_bundle', {
    p_receipt: args.receipt,
    p_items: args.bundle.items,
    p_new_products: args.bundle.newProducts,
    p_product_backfills: args.bundle.backfills,
    p_product_enrichments: args.bundle.enrichments,
    p_replace: args.replace,
  });
  if (error) {
    throw wrapError(args.replace ? 'Receipt update failed' : 'Receipt save failed', error);
  }
  return {
    receipt_id: args.receipt.id,
    items_count: readItemsCount(data) ?? args.bundle.items.length,
  };
}
