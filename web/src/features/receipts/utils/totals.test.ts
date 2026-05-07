import { describe, it, expect } from 'vitest';
import { computeRowTotal, computeGrandTotal, computeCategoryBreakdown } from './totals';
import type { ItemFormValues } from '../schemas/manual-form';

const row = (overrides: Partial<ItemFormValues>): Partial<ItemFormValues> => ({
  product_name: 'X',
  category: 'Бакалія',
  qty: 1,
  unit_price_orig: 1,
  consumed_by: 'shared',
  ...overrides,
});

describe('computeRowTotal', () => {
  it('multiplies qty * unit_price_orig when no discount', () => {
    expect(computeRowTotal(row({ qty: 3, unit_price_orig: 1.1 }))).toBe(3.3);
  });

  it('subtracts per-unit discount', () => {
    expect(computeRowTotal(row({ qty: 1, unit_price_orig: 2.99, discount_orig: 1 }))).toBe(1.99);
  });

  it('multiplies discount with qty', () => {
    expect(computeRowTotal(row({ qty: 3, unit_price_orig: 5, discount_orig: 0.5 }))).toBe(13.5);
  });

  it('preserves negative prices (Pfand refund)', () => {
    expect(computeRowTotal(row({ qty: 1, unit_price_orig: -8.25 }))).toBe(-8.25);
  });

  it('returns 0 for undefined input', () => {
    expect(computeRowTotal(undefined)).toBe(0);
  });

  it('coerces non-numeric inputs to 0', () => {
    expect(computeRowTotal(row({ qty: Number.NaN, unit_price_orig: 5 }))).toBe(0);
  });

  it('rounds at 2dp (avoids float drift)', () => {
    expect(computeRowTotal(row({ qty: 0.1 + 0.2, unit_price_orig: 1 }))).toBe(0.3);
  });
});

describe('computeGrandTotal', () => {
  it('sums positive items', () => {
    const total = computeGrandTotal([
      row({ qty: 1, unit_price_orig: 2.5 }),
      row({ qty: 2, unit_price_orig: 1.25 }),
    ]);
    expect(total).toBe(5);
  });

  it('nets positive and negative items (cancellation flow)', () => {
    const total = computeGrandTotal([
      row({ qty: 1, unit_price_orig: 2.99 }),
      row({ qty: 1, unit_price_orig: -2.99 }),
    ]);
    expect(total).toBe(0);
  });

  it('handles empty array', () => {
    expect(computeGrandTotal([])).toBe(0);
  });
});

describe('computeCategoryBreakdown', () => {
  it('groups items by category and rounds totals', () => {
    const breakdown = computeCategoryBreakdown([
      row({ category: 'Бакалія', qty: 1, unit_price_orig: 2.5 }),
      row({ category: 'Бакалія', qty: 2, unit_price_orig: 1 }),
      row({ category: 'Молочка', qty: 1, unit_price_orig: 1.2 }),
    ]);
    expect(breakdown).toEqual([
      { category: 'Бакалія', total: 4.5 },
      { category: 'Молочка', total: 1.2 },
    ]);
  });

  it('skips items with empty category', () => {
    const breakdown = computeCategoryBreakdown([
      row({ category: '', qty: 1, unit_price_orig: 5 }),
      row({ category: 'Молочка', qty: 1, unit_price_orig: 1 }),
    ]);
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]?.category).toBe('Молочка');
  });

  it('preserves negative subtotals', () => {
    const breakdown = computeCategoryBreakdown([
      row({ category: 'Pfand', qty: 1, unit_price_orig: -0.25 }),
    ]);
    expect(breakdown).toEqual([{ category: 'Pfand', total: -0.25 }]);
  });
});
