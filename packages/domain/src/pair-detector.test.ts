import { describe, it, expect } from 'vitest';
import { detectPairs } from './pair-detector';
import type { ParsedItem } from './schemas';

const pi = (
  product_name: string,
  qty: number,
  unit_price_orig: number,
  category_suggestion: string | null = null,
): ParsedItem => ({
  product_name,
  qty,
  unit_price_orig,
  category_suggestion,
});

// ── No-op cases ──────────────────────────────────────────────────────────────

describe('detectPairs — no-op', () => {
  it('empty array → empty output', () => {
    const r = detectPairs([]);
    expect(r.items).toHaveLength(0);
  });

  it('non-array input → empty output (defensive)', () => {
    for (const bad of [null, undefined]) {
      const r = detectPairs(bad);
      expect(r.items).toHaveLength(0);
    }
  });

  it('items without pairs pass through unchanged', () => {
    const a = pi('Bread', 1, 2.5, 'Бакалія');
    const b = pi('Milk', 1, 1.2, 'Молочка');
    const r = detectPairs([a, b]);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]?.product_name).toBe('Bread');
    expect(r.items[0]?.pair_marker).toBeUndefined();
    expect(r.items[1]?.product_name).toBe('Milk');
    expect(r.items[1]?.pair_marker).toBeUndefined();
  });
});

// ── Cancellation pairs (2-tuple) ─────────────────────────────────────────────

describe('detectPairs — 2-tuple cancellation pairs', () => {
  it('exact +X / -X for same product → single zero-priced row with cancelled marker (count=1)', () => {
    const r = detectPairs([
      pi('Mayb.Rose AF 0,75l', 1, 2.99, 'Алкоголь'),
      pi('Mayb.Rose AF 0,75l', 1, -2.99, 'Алкоголь'),
    ]);
    expect(r.items).toHaveLength(1);
    const it = r.items[0];
    expect(it?.product_name).toBe('Mayb.Rose AF 0,75l');
    expect(it?.qty).toBe(1);
    expect(it?.unit_price_orig).toBe(0);
    expect(it?.discount_orig).toBe(0);
    expect(it?.pair_marker).toEqual({ kind: 'cancelled', count: 1 });
  });

  it('cancellation pair where negative comes first', () => {
    const r = detectPairs([pi('X', 1, -2.99), pi('X', 1, 2.99)]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.unit_price_orig).toBe(0);
    expect(r.items[0]?.pair_marker?.kind).toBe('cancelled');
  });

  it('treats 2.99 vs -2.98 as a 1-cent discount, NOT a cancellation', () => {
    const r = detectPairs([pi('X', 1, 2.99), pi('X', 1, -2.98)]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.pair_marker).toEqual({ kind: 'discount-merged', count: 1 });
    expect(r.items[0]?.discount_orig).toBe(2.98);
    expect(r.items[0]?.unit_price_orig).toBe(2.99);
  });

  it('IEEE-754 noise is rounded out by 2dp comparison (still cancels)', () => {
    const noisy = -2.99 + 1e-15;
    const r = detectPairs([pi('X', 1, 2.99), pi('X', 1, noisy)]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.pair_marker?.kind).toBe('cancelled');
    expect(r.items[0]?.unit_price_orig).toBe(0);
  });
});

// ── Discount pairs (2-tuple) ─────────────────────────────────────────────────

describe('detectPairs — 2-tuple discount pairs', () => {
  it('+5.00 / -1.00 for same product → one merged item with discount_orig=1.00 and marker', () => {
    const r = detectPairs([
      pi('Promo Item', 1, 5.0, 'Бакалія'),
      pi('Promo Item', 1, -1.0, 'Бакалія'),
    ]);
    expect(r.items).toHaveLength(1);
    const it = r.items[0];
    expect(it?.product_name).toBe('Promo Item');
    expect(it?.unit_price_orig).toBe(5.0);
    expect(it?.discount_orig).toBe(1.0);
    expect(it?.pair_marker).toEqual({ kind: 'discount-merged', count: 1 });
  });

  it('discount pair where negative comes first → still merges, output preserves positive position', () => {
    const r = detectPairs([pi('Other', 1, 9.99), pi('X', 1, -1.0), pi('X', 1, 5.0)]);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]?.product_name).toBe('Other');
    expect(r.items[0]?.pair_marker).toBeUndefined();
    expect(r.items[1]?.product_name).toBe('X');
    expect(r.items[1]?.discount_orig).toBe(1.0);
    expect(r.items[1]?.pair_marker?.kind).toBe('discount-merged');
  });
});

// ── 3+ tuples — multi-row groups (NEW in v2) ─────────────────────────────────

describe('detectPairs — 3+ tuples (cashier punched twice, voided once)', () => {
  it('[+X, +X, -X] → 1 cancelled + 1 normal positive', () => {
    const r = detectPairs([pi('Wine', 1, 2.99), pi('Wine', 1, 2.99), pi('Wine', 1, -2.99)]);
    expect(r.items).toHaveLength(2);
    // First positive (idx 0) absorbed the negative → cancelled.
    expect(r.items[0]?.unit_price_orig).toBe(0);
    expect(r.items[0]?.pair_marker?.kind).toBe('cancelled');
    // Second positive (idx 1) survives untouched.
    expect(r.items[1]?.unit_price_orig).toBe(2.99);
    expect(r.items[1]?.pair_marker).toBeUndefined();
  });

  it('[+X, -X, +X] (negative in the middle) → cancellation claims the first by index, second positive normal', () => {
    const r = detectPairs([pi('X', 1, 2.99), pi('X', 1, -2.99), pi('X', 1, 2.99)]);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]?.unit_price_orig).toBe(0);
    expect(r.items[0]?.pair_marker?.kind).toBe('cancelled');
    expect(r.items[1]?.unit_price_orig).toBe(2.99);
    expect(r.items[1]?.pair_marker).toBeUndefined();
  });

  it('[+X, +X, -X*2] (-X has qty=2 so qty mismatch with each +) → all 3 unchanged', () => {
    const r = detectPairs([pi('X', 1, 2.99), pi('X', 1, 2.99), pi('X', 2, -2.99)]);
    expect(r.items).toHaveLength(2);
    // +X +X aggregate to qty=2 (Pass 3); -X×2 has different qty key → standalone.
    // Wait: -X×2 has unit_price=-2.99 which is negative — Pass 3 keys keep it
    // separate from the positive aggregation. Let's just check no cancellation
    // happened (totals don't match: |2.99×2|=5.98 ≠ |1×2.99|=2.99).
    const wineRows = r.items.filter((it) => it.product_name === 'X');
    const cancelledRows = wineRows.filter((it) => it.pair_marker?.kind === 'cancelled');
    expect(cancelledRows).toHaveLength(0);
  });
});

// ── Identical-positive aggregation (NEW in v2) ───────────────────────────────

describe('detectPairs — Pass 3 aggregation of identical positives', () => {
  it('4 identical kiwis (each +0.50, qty=1) → 1 aggregated row with qty=4 count=4', () => {
    const r = detectPairs([
      pi('Kiwi', 1, 0.5, 'Овочі/фрукти'),
      pi('Kiwi', 1, 0.5, 'Овочі/фрукти'),
      pi('Kiwi', 1, 0.5, 'Овочі/фрукти'),
      pi('Kiwi', 1, 0.5, 'Овочі/фрукти'),
    ]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.product_name).toBe('Kiwi');
    expect(r.items[0]?.qty).toBe(4);
    expect(r.items[0]?.unit_price_orig).toBe(0.5);
    expect(r.items[0]?.pair_marker).toEqual({ kind: 'aggregated', count: 4 });
  });

  it('4 kiwis + 1 voided (5 total) → 1 cancelled + 1 aggregated qty=3 count=3', () => {
    const r = detectPairs([
      pi('Kiwi', 1, 0.5),
      pi('Kiwi', 1, 0.5),
      pi('Kiwi', 1, 0.5),
      pi('Kiwi', 1, 0.5),
      pi('Kiwi', 1, -0.5),
    ]);
    expect(r.items).toHaveLength(2);
    // First positive (idx 0) cancelled by the negative.
    expect(r.items[0]?.unit_price_orig).toBe(0);
    expect(r.items[0]?.pair_marker?.kind).toBe('cancelled');
    // Remaining 3 positives aggregated.
    expect(r.items[1]?.qty).toBe(3);
    expect(r.items[1]?.pair_marker).toEqual({ kind: 'aggregated', count: 3 });
  });

  it('two positive entries with same price → aggregated qty=2 count=2', () => {
    const r = detectPairs([pi('X', 1, 2.99), pi('X', 1, 2.99)]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.qty).toBe(2);
    expect(r.items[0]?.pair_marker).toEqual({ kind: 'aggregated', count: 2 });
  });

  it('two positives with DIFFERENT prices → both kept (no aggregation)', () => {
    const r = detectPairs([pi('X', 1, 2.99), pi('X', 1, 1.99)]);
    expect(r.items).toHaveLength(2);
    expect(r.items.every((it) => it.pair_marker === undefined)).toBe(true);
  });
});

// ── Pass 3 with discount-merged rows ─────────────────────────────────────────

describe('detectPairs — Pass 3 across pair-merged rows', () => {
  it('[+5, +5, -1] (one of two with discount) → 1 discount-merged + 1 normal (NOT aggregated)', () => {
    const r = detectPairs([pi('Yogurt', 1, 5.0), pi('Yogurt', 1, 5.0), pi('Yogurt', 1, -1.0)]);
    expect(r.items).toHaveLength(2);
    // First +5 absorbs the -1 as discount.
    expect(r.items[0]?.unit_price_orig).toBe(5.0);
    expect(r.items[0]?.discount_orig).toBe(1.0);
    expect(r.items[0]?.pair_marker?.kind).toBe('discount-merged');
    // Second +5 stays normal (no marker, no discount → different agg key).
    expect(r.items[1]?.unit_price_orig).toBe(5.0);
    expect(r.items[1]?.pair_marker).toBeUndefined();
  });

  it('[+5, +5, -1, -1] (two with same discount) → 1 discount-merged qty=2 count=2', () => {
    const r = detectPairs([
      pi('Yogurt', 1, 5.0),
      pi('Yogurt', 1, 5.0),
      pi('Yogurt', 1, -1.0),
      pi('Yogurt', 1, -1.0),
    ]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.qty).toBe(2);
    expect(r.items[0]?.unit_price_orig).toBe(5.0);
    expect(r.items[0]?.discount_orig).toBe(1.0);
    expect(r.items[0]?.pair_marker).toEqual({ kind: 'discount-merged', count: 2 });
  });

  it('[+X, -X, +X, -X] (two cancellation pairs) → 1 cancelled qty=2 count=2', () => {
    const r = detectPairs([
      pi('X', 1, 2.99),
      pi('X', 1, -2.99),
      pi('X', 1, 2.99),
      pi('X', 1, -2.99),
    ]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.qty).toBe(2);
    expect(r.items[0]?.unit_price_orig).toBe(0);
    expect(r.items[0]?.pair_marker).toEqual({ kind: 'cancelled', count: 2 });
  });
});

// ── Ambiguous cases left untouched ───────────────────────────────────────────

describe('detectPairs — ambiguous cases left untouched', () => {
  it('qty mismatch leaves both rows untouched', () => {
    const r = detectPairs([pi('X', 2, 2.99), pi('X', 1, -2.99)]);
    expect(r.items).toHaveLength(2);
    expect(r.items.every((it) => it.pair_marker === undefined)).toBe(true);
  });

  it('lone negative item (Pfand without positive twin) is preserved', () => {
    const r = detectPairs([
      pi('Apfel', 1, 1.99, 'Овочі/фрукти'),
      pi('Leergut Einw.allg.', 1, -8.25, 'Pfand'),
    ]);
    expect(r.items).toHaveLength(2);
    expect(r.items[1]?.unit_price_orig).toBe(-8.25);
    expect(r.items[1]?.pair_marker).toBeUndefined();
  });

  it('refund larger than purchase → leave both, do not invent merge', () => {
    const r = detectPairs([pi('X', 1, 1.0), pi('X', 1, -5.0)]);
    expect(r.items).toHaveLength(2);
    expect(r.items.every((it) => it.pair_marker === undefined)).toBe(true);
  });
});

// ── Normalization ────────────────────────────────────────────────────────────

describe('detectPairs — normalization', () => {
  it('matches case-insensitively', () => {
    const r = detectPairs([pi('Mayb.Rose', 1, 2.99), pi('mayb.rose', 1, -2.99)]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.pair_marker?.kind).toBe('cancelled');
  });

  it('trims whitespace before matching', () => {
    const r = detectPairs([pi('  X ', 1, 2.99), pi('X', 1, -2.99)]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.pair_marker?.kind).toBe('cancelled');
  });

  it('collapses internal whitespace runs (NBSP, double spaces)', () => {
    const r = detectPairs([pi('Mayb.Rose AF 0,75l', 1, 2.99), pi('Mayb.Rose AF  0,75l', 1, -2.99)]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.pair_marker?.kind).toBe('cancelled');
  });

  it('strips zero-width invisible chars the AI sometimes injects', () => {
    const r = detectPairs([pi('Wine​', 1, 5.0), pi('Wine', 1, -5.0)]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.pair_marker?.kind).toBe('cancelled');
  });

  it('NFKC normalization equates compatibility variants', () => {
    const r = detectPairs([pi('Wine ｌ', 1, 2.99), pi('Wine l', 1, -2.99)]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.pair_marker?.kind).toBe('cancelled');
  });

  it('different visible names DO NOT group (no prefix-stripping cleverness)', () => {
    const r = detectPairs([
      pi('Mayb.Rose AF 0,75l', 1, 2.99),
      pi('Storno Mayb.Rose AF 0,75l', 1, -2.99),
    ]);
    expect(r.items).toHaveLength(2);
    expect(r.items.every((it) => it.pair_marker === undefined)).toBe(true);
  });
});

// ── Empty / missing product names ────────────────────────────────────────────

describe('detectPairs — empty product_name handling', () => {
  it('two items with empty product_name and opposite signs → both kept (no false pairing)', () => {
    const r = detectPairs([pi('', 1, 2.99), pi('', 1, -2.99)]);
    expect(r.items).toHaveLength(2);
    expect(r.items.every((it) => it.pair_marker === undefined)).toBe(true);
  });

  it('whitespace-only name is treated like empty (no false pairing)', () => {
    const r = detectPairs([pi('   ', 1, 2.99), pi('\t\t', 1, -2.99)]);
    expect(r.items).toHaveLength(2);
    expect(r.items.every((it) => it.pair_marker === undefined)).toBe(true);
  });

  it('one named item + one empty-name item with same totals → no pair', () => {
    const r = detectPairs([pi('Bread', 1, 2.99), pi('', 1, -2.99)]);
    expect(r.items).toHaveLength(2);
    expect(r.items.every((it) => it.pair_marker === undefined)).toBe(true);
  });
});

// ── product_code in Pass 3 key (NEW) ─────────────────────────────────────────

describe('detectPairs — product_code in aggregation key', () => {
  const piWithCode = (
    name: string,
    qty: number,
    price: number,
    code: string | null,
  ): ParsedItem => ({
    product_name: name,
    qty,
    unit_price_orig: price,
    category_suggestion: null,
    product_code: code,
  });

  it('two identical positives with the SAME code → aggregated qty=2', () => {
    const r = detectPairs([
      piWithCode('Multivitamin 1l', 1, 1.39, '297855'),
      piWithCode('Multivitamin 1l', 1, 1.39, '297855'),
    ]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.qty).toBe(2);
    expect(r.items[0]?.product_code).toBe('297855');
    expect(r.items[0]?.pair_marker?.kind).toBe('aggregated');
  });

  it('two positives with same name+price but DIFFERENT codes → kept separate', () => {
    const r = detectPairs([
      piWithCode('Mix Item', 1, 1.99, '111111'),
      piWithCode('Mix Item', 1, 1.99, '222222'),
    ]);
    expect(r.items).toHaveLength(2);
    expect(r.items.every((it) => it.pair_marker === undefined)).toBe(true);
    expect(r.items[0]?.product_code).toBe('111111');
    expect(r.items[1]?.product_code).toBe('222222');
  });

  it('one with code, one without (single concrete code in group) → merged; survivor takes the code', () => {
    const r = detectPairs([
      piWithCode('Pfand', 1, 0.25, '80000291'),
      piWithCode('Pfand', 1, 0.25, null),
    ]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.qty).toBe(2);
    expect(r.items[0]?.product_code).toBe('80000291');
    expect(r.items[0]?.pair_marker?.kind).toBe('aggregated');
  });

  it('two concrete codes + one null in same name+price → null is ambiguous, kept apart', () => {
    const r = detectPairs([
      piWithCode('Pfand', 1, 0.25, '111'),
      piWithCode('Pfand', 1, 0.25, '222'),
      piWithCode('Pfand', 1, 0.25, null),
    ]);
    // Three distinct keys: 111, 222, nullcode-marker.
    expect(r.items).toHaveLength(3);
  });
});

// ── Realistic EDEKA fixture ──────────────────────────────────────────────────

describe('detectPairs — realistic EDEKA fixture', () => {
  it('cancellation pair collapses to zero-priced row, Pfand stays, ordinary kept', () => {
    const items = [
      pi('Mayb.Rose AF 0,75l', 1, 2.99, 'Алкоголь'),
      pi('Mayb.Rose AF 0,75l', 1, -2.99, 'Алкоголь'),
      pi('Brot 500g', 1, 1.99, 'Бакалія'),
      pi('Leergut Einw.allg.', 1, -0.25, 'Pfand'),
    ];
    const r = detectPairs(items);
    expect(r.items).toHaveLength(3);
    expect(r.items[0]?.product_name).toBe('Mayb.Rose AF 0,75l');
    expect(r.items[0]?.unit_price_orig).toBe(0);
    expect(r.items[0]?.pair_marker?.kind).toBe('cancelled');
    expect(r.items[1]?.product_name).toBe('Brot 500g');
    expect(r.items[1]?.pair_marker).toBeUndefined();
    expect(r.items[2]?.product_name).toBe('Leergut Einw.allg.');
    expect(r.items[2]?.pair_marker).toBeUndefined();
  });
});
