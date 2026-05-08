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

// ── Cancellation pairs ───────────────────────────────────────────────────────

describe('detectPairs — cancellation pairs', () => {
  it('exact +X / -X for same product → single zero-priced row with cancelled marker', () => {
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
    expect(it?.pair_marker?.kind).toBe('cancelled');
  });

  it('cancellation pair where negative comes first → still produces one cancelled row', () => {
    const r = detectPairs([pi('X', 1, -2.99), pi('X', 1, 2.99)]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.unit_price_orig).toBe(0);
    expect(r.items[0]?.pair_marker?.kind).toBe('cancelled');
  });

  it('treats 2.99 vs -2.98 as a 1-cent discount, NOT a cancellation', () => {
    // posTotal=2.99, negTotalAbs=2.98 → 1-cent discount.
    const r = detectPairs([pi('X', 1, 2.99), pi('X', 1, -2.98)]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.pair_marker?.kind).toBe('discount-merged');
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

// ── Discount pairs ───────────────────────────────────────────────────────────

describe('detectPairs — discount pairs', () => {
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
    expect(it?.pair_marker?.kind).toBe('discount-merged');
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

// ── Ambiguous / not-our-case ─────────────────────────────────────────────────

describe('detectPairs — ambiguous cases left untouched', () => {
  it('qty mismatch leaves both rows untouched', () => {
    const r = detectPairs([pi('X', 2, 2.99), pi('X', 1, -2.99)]);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]?.pair_marker).toBeUndefined();
    expect(r.items[1]?.pair_marker).toBeUndefined();
  });

  it('3+ occurrences of same name → leave all untouched', () => {
    const r = detectPairs([pi('X', 1, 2.99), pi('X', 1, 2.99), pi('X', 1, -2.99)]);
    expect(r.items).toHaveLength(3);
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

  it('two positive entries (bought 2 separately) → both kept, no merge', () => {
    const r = detectPairs([pi('X', 1, 2.99), pi('X', 1, 2.99)]);
    expect(r.items).toHaveLength(2);
    expect(r.items.every((it) => it.pair_marker === undefined)).toBe(true);
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
});

// ── Empty / missing product names ────────────────────────────────────────────

describe('detectPairs — empty product_name handling', () => {
  it('two items with empty product_name and opposite signs → both kept (no false pairing)', () => {
    // Empty names get skipped at grouping → they don't pair up under '' key.
    // Otherwise the detector would happily merge two unrelated unnamed lines.
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
