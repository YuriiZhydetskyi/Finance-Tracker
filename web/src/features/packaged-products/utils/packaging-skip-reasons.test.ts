import { describe, expect, it } from 'vitest';
import type { SkippedPackagingProductRow } from '../types';
import {
  countBySkipReason,
  filterSkippedProducts,
  skipReasonLabel,
} from './packaging-skip-reasons';

function row(overrides: Partial<SkippedPackagingProductRow> = {}): SkippedPackagingProductRow {
  return {
    id: 'p1',
    name: 'Bananen',
    store: 'REWE',
    store_product_code: null,
    category: 'Овочі/фрукти',
    brand: null,
    packaging_not_applicable_reason: 'weighed',
    ...overrides,
  };
}

describe('skipReasonLabel', () => {
  it('names every rule and tells hand-made flags apart', () => {
    expect(skipReasonLabel('weighed')).toBe('вагове');
    expect(skipReasonLabel('service')).toBe('послуга, паливо');
    expect(skipReasonLabel('non_food')).toBe('не їжа');
    expect(skipReasonLabel('bag')).toBe('пакет');
    expect(skipReasonLabel(null)).toBe('позначено вручну');
  });

  it('shows an unknown future reason as it is instead of hiding it', () => {
    expect(skipReasonLabel('something_new')).toBe('something_new');
  });
});

describe('filterSkippedProducts', () => {
  const rows = [
    row({ id: 'a', name: 'Bananen' }),
    row({ id: 'b', name: 'Super SB', store: 'AVEX', category: 'Авто' }),
    row({ id: 'c', name: 'Tragetasche', brand: 'Edeka', store_product_code: '4711' }),
  ];

  it('returns everything for an empty query', () => {
    expect(filterSkippedProducts(rows, '  ')).toEqual(rows);
  });

  it('matches name, brand, store, category and code, ignoring case', () => {
    expect(filterSkippedProducts(rows, 'banan').map((r) => r.id)).toEqual(['a']);
    expect(filterSkippedProducts(rows, 'avex').map((r) => r.id)).toEqual(['b']);
    expect(filterSkippedProducts(rows, 'авто').map((r) => r.id)).toEqual(['b']);
    expect(filterSkippedProducts(rows, 'EDEKA').map((r) => r.id)).toEqual(['c']);
    expect(filterSkippedProducts(rows, '4711').map((r) => r.id)).toEqual(['c']);
    expect(filterSkippedProducts(rows, 'nothing')).toEqual([]);
  });
});

describe('countBySkipReason', () => {
  it('counts per reason, biggest first (ties alphabetical), hand-made flags as their own group', () => {
    const counts = countBySkipReason([
      row({ id: '1' }),
      row({ id: '2' }),
      row({ id: '3', packaging_not_applicable_reason: 'bag' }),
      row({ id: '4', packaging_not_applicable_reason: null }),
    ]);
    expect(counts).toEqual([
      { reason: 'weighed', label: 'вагове', count: 2 },
      { reason: 'bag', label: 'пакет', count: 1 },
      { reason: null, label: 'позначено вручну', count: 1 },
    ]);
  });
});
