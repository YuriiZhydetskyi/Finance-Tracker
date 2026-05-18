import { describe, it, expect } from 'vitest';
import {
  WasteSearchSchema,
  countActiveWasteFilters,
  defaultDateFrom,
  searchToWasteFilters,
} from './waste-search';

describe('WasteSearchSchema', () => {
  it('accepts empty object (bare /waste URL)', () => {
    expect(() => WasteSearchSchema.parse({})).not.toThrow();
  });

  it('accepts all known keys', () => {
    const parsed = WasteSearchSchema.parse({
      q: 'milk',
      category: 'Молочка',
      from: '2026-03-01',
      to: '2026-05-01',
      store: 'Aldi',
      min: '1.5',
      max: '20',
      showAll: 'true',
    });
    expect(parsed).toMatchObject({
      q: 'milk',
      category: 'Молочка',
      from: '2026-03-01',
      to: '2026-05-01',
      store: 'Aldi',
      min: 1.5,
      max: 20,
      showAll: true,
    });
  });

  it('rejects bad date format', () => {
    expect(() => WasteSearchSchema.parse({ from: '01.03.2026' })).toThrow();
  });

  it('coerces numeric strings via z.coerce', () => {
    const parsed = WasteSearchSchema.parse({ min: '5.5' });
    expect(parsed?.min).toBe(5.5);
  });
});

describe('defaultDateFrom', () => {
  it('returns 60 days before the given date in YYYY-MM-DD', () => {
    const today = new Date('2026-05-18T12:00:00Z');
    const from = defaultDateFrom(today);
    expect(from).toBe('2026-03-19');
  });

  it('handles year boundary', () => {
    const today = new Date('2026-01-15T00:00:00Z');
    const from = defaultDateFrom(today);
    expect(from).toBe('2025-11-16');
  });
});

describe('searchToWasteFilters', () => {
  it('falls back to defaultDateFrom when "from" missing', () => {
    const f = searchToWasteFilters({});
    expect(f.dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(f.showFullyWasted).toBe(false);
  });

  it('honours explicit "from" overriding the default window', () => {
    const f = searchToWasteFilters({ from: '2025-01-01' });
    expect(f.dateFrom).toBe('2025-01-01');
  });

  it('omits keys with null/undefined to keep exactOptionalPropertyTypes happy', () => {
    const f = searchToWasteFilters({});
    expect('nameSearch' in f).toBe(false);
    expect('category' in f).toBe(false);
    expect('storeSearch' in f).toBe(false);
    expect('priceMin' in f).toBe(false);
    expect('priceMax' in f).toBe(false);
  });

  it('propagates all filters when present', () => {
    const f = searchToWasteFilters({
      q: 'bread',
      category: 'Бакалія',
      from: '2026-03-01',
      to: '2026-05-01',
      store: 'Lidl',
      min: 1,
      max: 10,
      showAll: true,
    });
    expect(f).toEqual({
      nameSearch: 'bread',
      category: 'Бакалія',
      dateFrom: '2026-03-01',
      dateTo: '2026-05-01',
      storeSearch: 'Lidl',
      priceMin: 1,
      priceMax: 10,
      showFullyWasted: true,
    });
  });
});

describe('countActiveWasteFilters', () => {
  it('returns 0 for empty search', () => {
    expect(countActiveWasteFilters({})).toBe(0);
  });

  it('counts each non-default field', () => {
    expect(countActiveWasteFilters({ q: 'x', category: 'Y' })).toBe(2);
    expect(countActiveWasteFilters({ showAll: true })).toBe(1);
    expect(countActiveWasteFilters({ showAll: false })).toBe(0);
  });

  it('ignores empty strings', () => {
    expect(countActiveWasteFilters({ q: '' })).toBe(0);
  });
});
