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
    expect(r.cancellations).toHaveLength(0);
  });

  it('non-array input → empty output (defensive)', () => {
    for (const bad of [null, undefined]) {
      const r = detectPairs(bad);
      expect(r.items).toHaveLength(0);
      expect(r.cancellations).toHaveLength(0);
    }
  });

  it('items without pairs pass through unchanged', () => {
    const a = pi('Bread', 1, 2.5, 'Бакалія');
    const b = pi('Milk', 1, 1.2, 'Молочка');
    const r = detectPairs([a, b]);
    expect(r.items).toHaveLength(2);
    expect(r.cancellations).toHaveLength(0);
    expect(r.items[0]?.product_name).toBe('Bread');
    expect(r.items[1]?.product_name).toBe('Milk');
  });
});

// ── Cancellation pairs ───────────────────────────────────────────────────────

describe('detectPairs — cancellation pairs', () => {
  it('exact +X / -X for same product → cancellation card, no items', () => {
    const r = detectPairs([
      pi('Mayb.Rose AF 0,75l', 1, 2.99, 'Алкоголь'),
      pi('Mayb.Rose AF 0,75l', 1, -2.99, 'Алкоголь'),
    ]);
    expect(r.items).toHaveLength(0);
    expect(r.cancellations).toHaveLength(1);
    expect(r.cancellations[0]?.product_name).toBe('Mayb.Rose AF 0,75l');
    expect(r.cancellations[0]?.qty).toBe(1);
    expect(r.cancellations[0]?.unit_price_orig).toBe(2.99);
  });

  it('cancellation pair where negative comes first', () => {
    const r = detectPairs([pi('X', 1, -2.99), pi('X', 1, 2.99)]);
    expect(r.items).toHaveLength(0);
    expect(r.cancellations).toHaveLength(1);
  });

  it('treats 2.99 vs -2.98 as a 1-cent discount, NOT a cancellation', () => {
    // posTotal=2.99, negTotalAbs=2.98 → 1-cent discount.
    const r = detectPairs([pi('X', 1, 2.99), pi('X', 1, -2.98)]);
    expect(r.cancellations).toHaveLength(0);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.discount_orig).toBe(2.98);
  });

  it('IEEE-754 noise is rounded out by 2dp comparison (still merges)', () => {
    const noisy = -2.99 + 1e-15;
    const r = detectPairs([pi('X', 1, 2.99), pi('X', 1, noisy)]);
    expect(r.cancellations).toHaveLength(1);
    expect(r.items).toHaveLength(0);
  });
});

// ── Discount pairs ───────────────────────────────────────────────────────────

describe('detectPairs — discount pairs', () => {
  it('+5.00 / -1.00 for same product → one merged item, discount_orig=1.00', () => {
    const r = detectPairs([
      pi('Promo Item', 1, 5.0, 'Бакалія'),
      pi('Promo Item', 1, -1.0, 'Бакалія'),
    ]);
    expect(r.items).toHaveLength(1);
    expect(r.cancellations).toHaveLength(0);
    expect(r.items[0]?.product_name).toBe('Promo Item');
    expect(r.items[0]?.unit_price_orig).toBe(5.0);
    expect(r.items[0]?.discount_orig).toBe(1.0);
  });

  it('discount pair where negative comes first → still merges, output preserves positive position', () => {
    const r = detectPairs([pi('Other', 1, 9.99), pi('X', 1, -1.0), pi('X', 1, 5.0)]);
    expect(r.items).toHaveLength(2);
    // Positive 'X' was at input index 2 → output index 1 after 'Other'.
    expect(r.items[0]?.product_name).toBe('Other');
    expect(r.items[1]?.product_name).toBe('X');
    expect(r.items[1]?.discount_orig).toBe(1.0);
  });
});

// ── Ambiguous / not-our-case ─────────────────────────────────────────────────

describe('detectPairs — ambiguous cases left untouched', () => {
  it('qty mismatch leaves both rows untouched', () => {
    const r = detectPairs([pi('X', 2, 2.99), pi('X', 1, -2.99)]);
    expect(r.items).toHaveLength(2);
    expect(r.cancellations).toHaveLength(0);
  });

  it('3+ occurrences of same name → leave all untouched', () => {
    const r = detectPairs([pi('X', 1, 2.99), pi('X', 1, 2.99), pi('X', 1, -2.99)]);
    expect(r.items).toHaveLength(3);
    expect(r.cancellations).toHaveLength(0);
  });

  it('lone negative item (Pfand without positive twin) is preserved', () => {
    const r = detectPairs([
      pi('Apfel', 1, 1.99, 'Овочі/фрукти'),
      pi('Leergut Einw.allg.', 1, -8.25, 'Pfand'),
    ]);
    expect(r.items).toHaveLength(2);
    expect(r.items[1]?.unit_price_orig).toBe(-8.25);
  });

  it('two positive entries (bought 2 separately) → both kept, no merge', () => {
    const r = detectPairs([pi('X', 1, 2.99), pi('X', 1, 2.99)]);
    expect(r.items).toHaveLength(2);
    expect(r.cancellations).toHaveLength(0);
  });

  it('refund larger than purchase → leave both, do not invent merge', () => {
    const r = detectPairs([pi('X', 1, 1.0), pi('X', 1, -5.0)]);
    expect(r.items).toHaveLength(2);
    expect(r.cancellations).toHaveLength(0);
  });
});

// ── Normalization ────────────────────────────────────────────────────────────

describe('detectPairs — normalization', () => {
  it('matches case-insensitively', () => {
    const r = detectPairs([pi('Mayb.Rose', 1, 2.99), pi('mayb.rose', 1, -2.99)]);
    expect(r.cancellations).toHaveLength(1);
  });

  it('trims whitespace before matching', () => {
    const r = detectPairs([pi('  X ', 1, 2.99), pi('X', 1, -2.99)]);
    expect(r.cancellations).toHaveLength(1);
  });
});

// ── Realistic EDEKA fixture ──────────────────────────────────────────────────

describe('detectPairs — realistic EDEKA fixture', () => {
  it('cancellation pair collapses, Pfand stays, ordinary kept', () => {
    const items = [
      pi('Mayb.Rose AF 0,75l', 1, 2.99, 'Алкоголь'),
      pi('Mayb.Rose AF 0,75l', 1, -2.99, 'Алкоголь'),
      pi('Brot 500g', 1, 1.99, 'Бакалія'),
      pi('Leergut Einw.allg.', 1, -0.25, 'Pfand'),
    ];
    const r = detectPairs(items);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]?.product_name).toBe('Brot 500g');
    expect(r.items[1]?.product_name).toBe('Leergut Einw.allg.');
    expect(r.cancellations).toHaveLength(1);
    expect(r.cancellations[0]?.product_name).toBe('Mayb.Rose AF 0,75l');
  });
});
