// Pure helper: given the items being saved on a receipt and the existing
// product rows for the same store, decide which existing product each item
// should link to (and which new products / code-backfills are needed).
//
// Identity rules — must mirror the partial unique indexes in the migration:
//   * Within a store, a product is identified by `store_product_code` if it
//     has one, else by `name`. Two products with the same name+store can
//     coexist as long as they have different codes (one may be NULL).
//
// Match priority for an incoming item:
//   1. If item has a code → look up existing by (store, code). Hit → link.
//      Else look for an existing code-LESS product with the same name in the
//      store; if found, BACKFILL the code onto it and link. Otherwise create
//      a new product with that code.
//   2. If item has NO code → look up existing code-less product by name.
//      Hit → link. Otherwise create a new product with NULL code. (We do
//      NOT match against products that have codes — the item without a code
//      could be the same SKU or a different one; without the code we can't
//      tell, and creating a fresh code-less row is the conservative choice.
//      The user can manually merge later.)
//
// Within a single receipt the same key may appear multiple times (e.g. two
// "Pfand"s before pair-detection runs, or two manual rows for the same item).
// The resolver dedupes within-batch creations via the `pendingBy*` maps so we
// never insert two new products for one logical match.

import { makeProduct } from '@finance-tracker/domain';
import type { ProductRow } from '@/features/products/api/use-products';

export type ItemKey = {
  product_name: string;
  store_product_code: string | null;
  category: string;
  product_family_id?: string | null;
  product_variant_id?: string | null;
  brand?: string | null;
  is_organic?: boolean | null;
  /** A person explicitly changed product metadata in the review form. */
  product_metadata_override?: boolean;
};

export type ProductBackfill = {
  id: string;
  store_product_code: string;
};

export type ProductEnrichment = {
  id: string;
  product_family_id?: string | null;
  product_variant_id?: string | null;
  brand?: string | null;
  is_organic?: boolean | null;
};

export type ResolveProductsResult = {
  productIdByIndex: string[];
  newProducts: ReturnType<typeof makeProduct>[];
  backfills: ProductBackfill[];
  enrichments: ProductEnrichment[];
};

function normalizeCode(code: string | null | undefined): string | null {
  if (code == null) return null;
  const trimmed = code.trim();
  return trimmed === '' ? null : trimmed;
}

export function resolveProducts(args: {
  store: string;
  items: ItemKey[];
  existingProducts: ProductRow[];
}): ResolveProductsResult {
  const { store, items, existingProducts } = args;

  const inStore = existingProducts.filter((p) => p.store === store);

  const byCode = new Map<string, ProductRow>();
  const byNameNoCode = new Map<string, ProductRow>();
  for (const p of inStore) {
    const code = normalizeCode(p.store_product_code);
    if (code != null) byCode.set(code, p);
    else byNameNoCode.set(p.name, p);
  }

  const pendingByCode = new Map<string, ReturnType<typeof makeProduct>>();
  const pendingByNameNoCode = new Map<string, ReturnType<typeof makeProduct>>();
  const backfillById = new Map<string, ProductBackfill>();
  const enrichmentById = new Map<string, ProductEnrichment>();
  const conflictingEnrichmentIds = new Set<string>();
  const productIdByIndex: string[] = [];

  for (const item of items) {
    const code = normalizeCode(item.store_product_code);

    if (code != null) {
      const existing = byCode.get(code);
      if (existing) {
        queueEnrichment(enrichmentById, conflictingEnrichmentIds, existing, item);
        productIdByIndex.push(existing.id);
        continue;
      }
      const pending = pendingByCode.get(code);
      if (pending) {
        productIdByIndex.push(pending.id);
        continue;
      }
      const nameMatch = byNameNoCode.get(item.product_name);
      if (nameMatch) {
        queueEnrichment(enrichmentById, conflictingEnrichmentIds, nameMatch, item);
        backfillById.set(nameMatch.id, { id: nameMatch.id, store_product_code: code });
        // Promote into the byCode map so subsequent same-coded items in this
        // batch link to it, and remove from the no-code map (it's no longer
        // a candidate for future code-less matches).
        byCode.set(code, { ...nameMatch, store_product_code: code });
        byNameNoCode.delete(nameMatch.name);
        productIdByIndex.push(nameMatch.id);
        continue;
      }
      const fresh = makeProduct({
        name: item.product_name,
        store,
        store_product_code: code,
        category: item.category,
        product_family_id: item.product_family_id ?? null,
        product_variant_id: item.product_variant_id ?? null,
        brand: item.brand ?? null,
        is_organic: item.is_organic ?? null,
      });
      pendingByCode.set(code, fresh);
      productIdByIndex.push(fresh.id);
      continue;
    }

    const existing = byNameNoCode.get(item.product_name);
    if (existing) {
      queueEnrichment(enrichmentById, conflictingEnrichmentIds, existing, item);
      productIdByIndex.push(existing.id);
      continue;
    }
    const pending = pendingByNameNoCode.get(item.product_name);
    if (pending) {
      productIdByIndex.push(pending.id);
      continue;
    }
    const fresh = makeProduct({
      name: item.product_name,
      store,
      store_product_code: null,
      category: item.category,
      product_family_id: item.product_family_id ?? null,
      product_variant_id: item.product_variant_id ?? null,
      brand: item.brand ?? null,
      is_organic: item.is_organic ?? null,
    });
    pendingByNameNoCode.set(item.product_name, fresh);
    productIdByIndex.push(fresh.id);
  }

  return {
    productIdByIndex,
    newProducts: [...pendingByCode.values(), ...pendingByNameNoCode.values()],
    backfills: [...backfillById.values()],
    enrichments: [...enrichmentById.values()],
  };
}

function queueEnrichment(
  enrichments: Map<string, ProductEnrichment>,
  conflicts: Set<string>,
  product: ProductRow,
  item: ItemKey,
): void {
  if (conflicts.has(product.id)) return;
  const current = enrichments.get(product.id) ?? { id: product.id };
  if (item.product_metadata_override) {
    if (!queueManualMetadata(current, product, item)) {
      conflicts.add(product.id);
      enrichments.delete(product.id);
      return;
    }
    if (Object.keys(current).length > 1) enrichments.set(product.id, current);
    return;
  }
  if (product.product_family_id == null && item.product_family_id != null) {
    if (
      current.product_family_id === undefined ||
      (current.product_family_id === item.product_family_id &&
        current.product_variant_id === (item.product_variant_id ?? null))
    ) {
      current.product_family_id = item.product_family_id;
      current.product_variant_id = item.product_variant_id ?? null;
    } else {
      // Two rows for the same SKU disagree: leave it for manual review.
      conflicts.add(product.id);
      enrichments.delete(product.id);
      return;
    }
  }
  if (product.brand == null && item.brand != null) {
    if (current.brand === undefined || current.brand === item.brand) current.brand = item.brand;
    else {
      conflicts.add(product.id);
      enrichments.delete(product.id);
      return;
    }
  }
  if (product.is_organic == null && item.is_organic != null) {
    if (current.is_organic === undefined || current.is_organic === item.is_organic) {
      current.is_organic = item.is_organic;
    } else {
      conflicts.add(product.id);
      enrichments.delete(product.id);
      return;
    }
  }
  if (Object.keys(current).length > 1) enrichments.set(product.id, current);
}

function queueManualMetadata(
  current: ProductEnrichment,
  product: ProductRow,
  item: ItemKey,
): boolean {
  const desiredFamily = item.product_family_id ?? null;
  const desiredVariant = item.product_variant_id ?? null;
  if (
    !queueOverride(current, 'product_family_id', product.product_family_id, desiredFamily) ||
    !queueOverride(current, 'product_variant_id', product.product_variant_id, desiredVariant) ||
    !queueOverride(current, 'brand', product.brand, item.brand ?? null) ||
    !queueOverride(current, 'is_organic', product.is_organic, item.is_organic ?? null)
  ) {
    return false;
  }
  return true;
}

function queueOverride<
  Key extends 'product_family_id' | 'product_variant_id' | 'brand' | 'is_organic',
>(
  current: ProductEnrichment,
  key: Key,
  existing: ProductEnrichment[Key],
  desired: ProductEnrichment[Key],
): boolean {
  const pending = current[key];
  if (pending !== undefined && pending !== desired) return false;
  if (existing !== desired || pending !== undefined) current[key] = desired;
  return true;
}
