import type { PackagedProductRow } from '../types';

type Searchable = Pick<PackagedProductRow, 'name' | 'brand' | 'barcode' | 'review_notes'>;

export function needsReview(product: Pick<PackagedProductRow, 'review_notes'>): boolean {
  return product.review_notes.length > 0;
}

/** Text search over name, brand and barcode, optionally narrowed to cards that need a check. */
export function filterCatalogue<T extends Searchable>(
  products: T[],
  { query, onlyNeedingReview }: { query: string; onlyNeedingReview: boolean },
): T[] {
  const needle = query.trim().toLowerCase();
  return products.filter(
    (product) =>
      (!onlyNeedingReview || needsReview(product)) &&
      (!needle ||
        product.name.toLowerCase().includes(needle) ||
        (product.brand?.toLowerCase().includes(needle) ?? false) ||
        (product.barcode?.includes(needle) ?? false)),
  );
}
