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

import { makeProduct, type Product } from '@finance-tracker/domain';
import type { ProductRow } from '@/features/products/api/use-products';

export type ItemKey = {
  product_name: string;
  store_product_code: string | null;
  category: string;
};

export type ProductBackfill = {
  id: string;
  store_product_code: string;
};

export type ResolveProductsResult = {
  productIdByIndex: string[];
  newProducts: Product[];
  backfills: ProductBackfill[];
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

  const pendingByCode = new Map<string, Product>();
  const pendingByNameNoCode = new Map<string, Product>();
  const backfillById = new Map<string, ProductBackfill>();
  const productIdByIndex: string[] = [];

  for (const item of items) {
    const code = normalizeCode(item.store_product_code);

    if (code != null) {
      const existing = byCode.get(code);
      if (existing) {
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
      });
      pendingByCode.set(code, fresh);
      productIdByIndex.push(fresh.id);
      continue;
    }

    const existing = byNameNoCode.get(item.product_name);
    if (existing) {
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
    });
    pendingByNameNoCode.set(item.product_name, fresh);
    productIdByIndex.push(fresh.id);
  }

  return {
    productIdByIndex,
    newProducts: [...pendingByCode.values(), ...pendingByNameNoCode.values()],
    backfills: [...backfillById.values()],
  };
}
