// Flattening a pasted blob into a list of packaged-product-shaped candidates.
// One paste may hold a single product, a top-level array, or a wrapper object —
// the same three shapes the receipt import already accepts.

const WRAPPER_KEYS = ['products', 'packaged_products', 'items'] as const;

export function toPackagedProductCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of WRAPPER_KEYS) {
      const wrapped = record[key];
      if (Array.isArray(wrapped)) return wrapped;
    }
    // { "product": {...} } — a single product under a singular wrapper.
    const single = record.product;
    if (single && typeof single === 'object' && !Array.isArray(single)) return [single];
  }
  return [value];
}
