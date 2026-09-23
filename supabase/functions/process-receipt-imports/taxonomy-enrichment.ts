import type { WorkerDeps } from './types.ts';

type EnrichmentDeps = Pick<WorkerDeps, 'db' | 'log'>;

type PreparedItemRow = Record<string, string | number | boolean | null>;

type PreparedProductSuggestion = {
  product_name: string;
  store_product_code: string | null;
  product_family_id: string | null;
  product_variant_id: string | null;
  brand: string | null;
  is_organic: boolean | null;
};

type SavedItem = {
  id: string;
  product_id: string | null;
  product_name: string;
  store_product_code: string | null;
  product_family_id: string | null;
  product_variant_id: string | null;
};

type SavedProduct = {
  id: string;
  product_family_id: string | null;
  product_variant_id: string | null;
  brand: string | null;
  is_organic: boolean | null;
};

type ProductClassification = { family: string | null; variant: string | null };

/**
 * Background finalizers intentionally own receipt/product creation. Enrich only
 * after a successful finalization, and only empty product attributes, so an
 * existing SKU or a user's earlier correction always wins over an AI proposal.
 */
export async function enrichSavedImportTaxonomy(
  deps: EnrichmentDeps,
  receipt: Record<string, string | number | null>,
  items: PreparedItemRow[],
): Promise<void> {
  const receiptId = typeof receipt.id === 'string' ? receipt.id : null;
  const store = typeof receipt.store === 'string' ? receipt.store : null;
  if (!receiptId || !store) return;

  const suggestions = collectSuggestions(items);
  if (suggestions.size === 0) return;

  const savedItems = await loadSavedItems(deps, receiptId);
  if (!savedItems) return;

  const suggestionByProductId = suggestionsByProduct(savedItems, suggestions);
  if (suggestionByProductId.size === 0) return;

  const products = await loadProducts(deps, receiptId, [...suggestionByProductId.keys()]);
  if (!products) return;

  const classificationByProductId = await enrichProducts(deps, products, suggestionByProductId);
  await classifyItems(deps, savedItems, classificationByProductId);
}

function collectSuggestions(items: PreparedItemRow[]): Map<string, PreparedProductSuggestion> {
  const suggestions = new Map<string, PreparedProductSuggestion>();
  for (const raw of items) {
    const suggestion = toSuggestion(raw);
    if (!suggestion) continue;
    const key = productKey(suggestion.product_name, suggestion.store_product_code);
    mergeInto(suggestions, key, suggestion);
  }
  return suggestions;
}

function toSuggestion(raw: PreparedItemRow): PreparedProductSuggestion | null {
  const productName = typeof raw.product_name === 'string' ? raw.product_name : null;
  if (!productName) return null;
  const suggestion: PreparedProductSuggestion = {
    product_name: productName,
    store_product_code: nonBlankString(raw.store_product_code),
    product_family_id: stringOrNull(raw.product_family_id),
    product_variant_id: stringOrNull(raw.product_variant_id),
    brand: nonBlankString(raw.brand),
    is_organic: typeof raw.is_organic === 'boolean' ? raw.is_organic : null,
  };
  return hasTaxonomySuggestion(suggestion) ? suggestion : null;
}

async function loadSavedItems(
  { db, log }: EnrichmentDeps,
  receiptId: string,
): Promise<SavedItem[] | null> {
  const { data, error } = await db
    .from('items')
    .select(
      'id, product_id, product_name, store_product_code, product_family_id, product_variant_id',
    )
    .eq('receipt_id', receiptId);
  if (error) {
    log.warn('[process-receipt-imports] taxonomy item lookup failed', receiptId);
    return null;
  }
  return (data ?? []) as SavedItem[];
}

function suggestionsByProduct(
  savedItems: SavedItem[],
  suggestions: Map<string, PreparedProductSuggestion>,
): Map<string, PreparedProductSuggestion> {
  const byProductId = new Map<string, PreparedProductSuggestion>();
  for (const item of savedItems) {
    if (!item.product_id) continue;
    const suggestion = suggestions.get(productKey(item.product_name, item.store_product_code));
    if (suggestion) mergeInto(byProductId, item.product_id, suggestion);
  }
  return byProductId;
}

async function loadProducts(
  { db, log }: EnrichmentDeps,
  receiptId: string,
  productIds: string[],
): Promise<SavedProduct[] | null> {
  const { data, error } = await db
    .from('products')
    .select('id, product_family_id, product_variant_id, brand, is_organic')
    .in('id', productIds);
  if (error) {
    log.warn('[process-receipt-imports] taxonomy product lookup failed', receiptId);
    return null;
  }
  return (data ?? []) as SavedProduct[];
}

async function enrichProducts(
  { db, log }: EnrichmentDeps,
  products: SavedProduct[],
  suggestionByProductId: Map<string, PreparedProductSuggestion>,
): Promise<Map<string, ProductClassification>> {
  const classificationByProductId = new Map<string, ProductClassification>();
  for (const product of products) {
    const suggestion = suggestionByProductId.get(product.id);
    if (!suggestion) continue;
    const patch = emptyAttributePatch(product, suggestion);
    classificationByProductId.set(product.id, {
      family: patch.product_family_id ?? product.product_family_id,
      variant: patch.product_variant_id ?? product.product_variant_id,
    });
    if (Object.keys(patch).length === 0) continue;
    const { error } = await db.from('products').update(patch).eq('id', product.id);
    if (error) log.warn('[process-receipt-imports] taxonomy product update failed', product.id);
  }
  return classificationByProductId;
}

function emptyAttributePatch(
  product: SavedProduct,
  suggestion: PreparedProductSuggestion,
): Partial<Omit<SavedProduct, 'id'>> {
  const patch: Partial<Omit<SavedProduct, 'id'>> = {};
  if (product.product_family_id == null && suggestion.product_family_id != null) {
    patch.product_family_id = suggestion.product_family_id;
    patch.product_variant_id = suggestion.product_variant_id;
  }
  if (product.brand == null && suggestion.brand != null) patch.brand = suggestion.brand;
  if (product.is_organic == null && suggestion.is_organic != null) {
    patch.is_organic = suggestion.is_organic;
  }
  return patch;
}

async function classifyItems(
  { db, log }: EnrichmentDeps,
  savedItems: SavedItem[],
  classificationByProductId: Map<string, ProductClassification>,
): Promise<void> {
  for (const item of savedItems) {
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

function mergeInto(
  target: Map<string, PreparedProductSuggestion>,
  key: string,
  suggestion: PreparedProductSuggestion,
): void {
  const current = target.get(key);
  target.set(key, current ? mergeSuggestion(current, suggestion) : suggestion);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function nonBlankString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
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
