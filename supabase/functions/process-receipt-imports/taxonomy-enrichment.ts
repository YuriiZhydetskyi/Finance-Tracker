import type { WorkerDeps } from './types.ts';

type PreparedProductSuggestion = {
  product_name: string;
  store_product_code: string | null;
  product_family_id: string | null;
  product_variant_id: string | null;
  brand: string | null;
  is_organic: boolean | null;
};

/**
 * Background finalizers intentionally own receipt/product creation. Enrich only
 * after a successful finalization, and only empty product attributes, so an
 * existing SKU or a user's earlier correction always wins over an AI proposal.
 */
export async function enrichSavedImportTaxonomy(
  deps: Pick<WorkerDeps, 'db' | 'log'>,
  receipt: Record<string, string | number | null>,
  items: Record<string, string | number | boolean | null>[],
): Promise<void> {
  const { db, log } = deps;
  const receiptId = typeof receipt.id === 'string' ? receipt.id : null;
  const store = typeof receipt.store === 'string' ? receipt.store : null;
  if (!receiptId || !store) return;

  const suggestions = new Map<string, PreparedProductSuggestion>();
  for (const raw of items) {
    const productName = typeof raw.product_name === 'string' ? raw.product_name : null;
    if (!productName) continue;
    const suggestion: PreparedProductSuggestion = {
      product_name: productName,
      store_product_code:
        typeof raw.store_product_code === 'string' && raw.store_product_code.trim()
          ? raw.store_product_code
          : null,
      product_family_id: typeof raw.product_family_id === 'string' ? raw.product_family_id : null,
      product_variant_id:
        typeof raw.product_variant_id === 'string' ? raw.product_variant_id : null,
      brand: typeof raw.brand === 'string' && raw.brand.trim() ? raw.brand : null,
      is_organic: typeof raw.is_organic === 'boolean' ? raw.is_organic : null,
    };
    if (!hasTaxonomySuggestion(suggestion)) continue;
    const key = productKey(suggestion.product_name, suggestion.store_product_code);
    const current = suggestions.get(key);
    suggestions.set(key, current ? mergeSuggestion(current, suggestion) : suggestion);
  }
  if (suggestions.size === 0) return;

  const { data: savedItems, error: savedItemsError } = await db
    .from('items')
    .select(
      'id, product_id, product_name, store_product_code, product_family_id, product_variant_id',
    )
    .eq('receipt_id', receiptId);
  if (savedItemsError) {
    log.warn('[process-receipt-imports] taxonomy item lookup failed', receiptId);
    return;
  }

  const rows = savedItems ?? [];
  const suggestionByProductId = new Map<string, PreparedProductSuggestion>();
  for (const item of rows) {
    if (!item.product_id) continue;
    const suggestion = suggestions.get(productKey(item.product_name, item.store_product_code));
    if (!suggestion) continue;
    const current = suggestionByProductId.get(item.product_id);
    suggestionByProductId.set(
      item.product_id,
      current ? mergeSuggestion(current, suggestion) : suggestion,
    );
  }
  const productIds = [...suggestionByProductId.keys()];
  if (productIds.length === 0) return;

  const { data: products, error: productsError } = await db
    .from('products')
    .select('id, product_family_id, product_variant_id, brand, is_organic')
    .in('id', productIds);
  if (productsError) {
    log.warn('[process-receipt-imports] taxonomy product lookup failed', receiptId);
    return;
  }

  const classificationByProductId = new Map<
    string,
    { family: string | null; variant: string | null }
  >();
  for (const product of products ?? []) {
    const suggestion = suggestionByProductId.get(product.id);
    if (!suggestion) continue;
    const patch: Record<string, string | boolean | null> = {};
    if (product.product_family_id == null && suggestion.product_family_id != null) {
      patch.product_family_id = suggestion.product_family_id;
      patch.product_variant_id = suggestion.product_variant_id;
    }
    if (product.brand == null && suggestion.brand != null) patch.brand = suggestion.brand;
    if (product.is_organic == null && suggestion.is_organic != null) {
      patch.is_organic = suggestion.is_organic;
    }
    const family = (patch.product_family_id as string | undefined) ?? product.product_family_id;
    const variant = (patch.product_variant_id as string | undefined) ?? product.product_variant_id;
    classificationByProductId.set(product.id, { family, variant });
    if (Object.keys(patch).length > 0) {
      const { error } = await db.from('products').update(patch).eq('id', product.id);
      if (error) log.warn('[process-receipt-imports] taxonomy product update failed', product.id);
    }
  }

  for (const item of rows) {
    if (!item.product_id || item.product_family_id != null) continue;
    const classification = classificationByProductId.get(item.product_id);
    if (!classification?.family) continue;
    const { error } = await db
      .from('items')
      .update({
        product_family_id: classification.family,
        product_variant_id: classification.variant,
      })
      .eq('id', item.id);
    if (error) log.warn('[process-receipt-imports] taxonomy item update failed', item.id);
  }
}

function productKey(productName: string, code: string | null): string {
  return code ? `code:${code}` : `name:${productName}`;
}

function hasTaxonomySuggestion(value: PreparedProductSuggestion): boolean {
  return value.product_family_id !== null || value.brand !== null || value.is_organic !== null;
}

function mergeSuggestion(
  left: PreparedProductSuggestion,
  right: PreparedProductSuggestion,
): PreparedProductSuggestion {
  const family = mergeScalar(left.product_family_id, right.product_family_id);
  const variant = family ? mergeScalar(left.product_variant_id, right.product_variant_id) : null;
  return {
    ...left,
    product_family_id: family,
    product_variant_id: variant,
    brand: mergeScalar(left.brand, right.brand),
    is_organic: mergeScalar(left.is_organic, right.is_organic),
  };
}

function mergeScalar<T>(left: T | null, right: T | null): T | null {
  if (left == null) return right;
  if (right == null) return left;
  return left === right ? left : null;
}
