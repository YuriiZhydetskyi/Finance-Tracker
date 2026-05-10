import { describe, it, expect } from 'vitest';
import { resolveProducts } from './resolve-products';
import type { ProductRow } from '@/features/products/api/use-products';

const STORE = 'ALDI SÜD';

// IDs are opaque to the resolver (it just propagates them). Tests assert on
// equality, not schema validity, so any unique string works.
function existing(rows: Partial<ProductRow>[]): ProductRow[] {
  return rows.map((r, i) => ({
    id: r.id ?? `existing-${String(i)}`,
    name: r.name ?? '',
    store: r.store ?? STORE,
    store_product_code: r.store_product_code ?? null,
    category: r.category ?? 'Інше',
  }));
}

describe('resolveProducts — match by code', () => {
  it('item with code matches existing product by (store, code) regardless of name', () => {
    const ex = existing([
      { id: 'P1', name: 'Multivitamin 1l', store_product_code: '297855', category: 'Напої' },
    ]);
    const r = resolveProducts({
      store: STORE,
      items: [{ product_name: 'Multivitamin 1l', store_product_code: '297855', category: 'Напої' }],
      existingProducts: ex,
    });
    expect(r.productIdByIndex).toEqual(['P1']);
    expect(r.newProducts).toHaveLength(0);
    expect(r.backfills).toHaveLength(0);
  });

  it('item with code that does not exist creates a new product', () => {
    const r = resolveProducts({
      store: STORE,
      items: [{ product_name: 'New Snack', store_product_code: '999999', category: 'Снеки' }],
      existingProducts: [],
    });
    expect(r.newProducts).toHaveLength(1);
    expect(r.newProducts[0]?.name).toBe('New Snack');
    expect(r.newProducts[0]?.store).toBe(STORE);
    expect(r.newProducts[0]?.store_product_code).toBe('999999');
    expect(r.newProducts[0]?.category).toBe('Снеки');
    expect(r.productIdByIndex[0]).toBe(r.newProducts[0]?.id);
  });
});

describe('resolveProducts — backfill', () => {
  it('item with code + existing code-LESS product with same name → backfill code, link to existing', () => {
    const ex = existing([
      { id: 'P1', name: 'Молоко', store_product_code: null, category: 'Молочка' },
    ]);
    const r = resolveProducts({
      store: STORE,
      items: [{ product_name: 'Молоко', store_product_code: '12345', category: 'Молочка' }],
      existingProducts: ex,
    });
    expect(r.productIdByIndex).toEqual(['P1']);
    expect(r.newProducts).toHaveLength(0);
    expect(r.backfills).toEqual([{ id: 'P1', store_product_code: '12345' }]);
  });

  it('after backfill, a second same-coded item in the SAME batch links to the same product (no dupe)', () => {
    const ex = existing([
      { id: 'P1', name: 'Молоко', store_product_code: null, category: 'Молочка' },
    ]);
    const r = resolveProducts({
      store: STORE,
      items: [
        { product_name: 'Молоко', store_product_code: '12345', category: 'Молочка' },
        { product_name: 'Молоко', store_product_code: '12345', category: 'Молочка' },
      ],
      existingProducts: ex,
    });
    expect(r.productIdByIndex).toEqual(['P1', 'P1']);
    expect(r.newProducts).toHaveLength(0);
    expect(r.backfills).toHaveLength(1);
  });
});

describe('resolveProducts — different code = different product (user rule)', () => {
  it('existing has code "111", new item has same name + code "222" → create new product, leave existing', () => {
    const ex = existing([
      { id: 'P1', name: 'Multivitamin 1l', store_product_code: '111', category: 'Напої' },
    ]);
    const r = resolveProducts({
      store: STORE,
      items: [{ product_name: 'Multivitamin 1l', store_product_code: '222', category: 'Напої' }],
      existingProducts: ex,
    });
    expect(r.newProducts).toHaveLength(1);
    expect(r.newProducts[0]?.store_product_code).toBe('222');
    expect(r.productIdByIndex[0]).toBe(r.newProducts[0]?.id);
    expect(r.backfills).toHaveLength(0);
  });
});

describe('resolveProducts — no code', () => {
  it('item without code matches existing code-less product by name', () => {
    const ex = existing([
      { id: 'P1', name: 'Молоко', store_product_code: null, category: 'Молочка' },
    ]);
    const r = resolveProducts({
      store: STORE,
      items: [{ product_name: 'Молоко', store_product_code: null, category: 'Молочка' }],
      existingProducts: ex,
    });
    expect(r.productIdByIndex).toEqual(['P1']);
    expect(r.newProducts).toHaveLength(0);
  });

  it('item without code does NOT match a same-named product that has a code (creates new code-less)', () => {
    const ex = existing([
      { id: 'P1', name: 'Молоко', store_product_code: '12345', category: 'Молочка' },
    ]);
    const r = resolveProducts({
      store: STORE,
      items: [{ product_name: 'Молоко', store_product_code: null, category: 'Молочка' }],
      existingProducts: ex,
    });
    expect(r.newProducts).toHaveLength(1);
    expect(r.newProducts[0]?.store_product_code).toBe(null);
    expect(r.productIdByIndex[0]).toBe(r.newProducts[0]?.id);
  });

  it('two no-code items with same name in one batch share a single new product', () => {
    const r = resolveProducts({
      store: STORE,
      items: [
        { product_name: 'Молоко', store_product_code: null, category: 'Молочка' },
        { product_name: 'Молоко', store_product_code: null, category: 'Молочка' },
      ],
      existingProducts: [],
    });
    expect(r.newProducts).toHaveLength(1);
    expect(r.productIdByIndex[0]).toBe(r.productIdByIndex[1]);
  });
});

describe('resolveProducts — store scoping', () => {
  it('ignores products in other stores when matching', () => {
    const ex = existing([
      { id: 'P_REWE', name: 'Молоко', store: 'REWE', store_product_code: null },
    ]);
    const r = resolveProducts({
      store: STORE,
      items: [{ product_name: 'Молоко', store_product_code: null, category: 'Молочка' }],
      existingProducts: ex,
    });
    expect(r.productIdByIndex[0]).not.toBe('P_REWE');
    expect(r.newProducts).toHaveLength(1);
    expect(r.newProducts[0]?.store).toBe(STORE);
  });
});

describe('resolveProducts — empty/whitespace code', () => {
  it('treats empty string code as null (creates a code-less product)', () => {
    const r = resolveProducts({
      store: STORE,
      items: [{ product_name: 'X', store_product_code: '   ', category: 'Інше' }],
      existingProducts: [],
    });
    expect(r.newProducts).toHaveLength(1);
    expect(r.newProducts[0]?.store_product_code).toBe(null);
  });
});
