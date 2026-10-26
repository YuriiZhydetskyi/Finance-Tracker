import { describe, it, expect } from 'vitest';
import { RecentSearchSchema, countActiveFilters, searchToFilters } from './recent-search';

describe('RecentSearchSchema', () => {
  it('accepts a bare /recent URL', () => {
    expect(RecentSearchSchema.parse({})).toEqual({});
  });

  it('parses every known key, coercing the amounts', () => {
    expect(
      RecentSearchSchema.parse({
        saved: '01HZ',
        q: 'Lidl',
        from: '2026-05-01',
        to: '2026-05-31',
        paid_by: 'you@example.com',
        min: '1.5',
        max: 20,
      }),
    ).toEqual({
      saved: '01HZ',
      q: 'Lidl',
      from: '2026-05-01',
      to: '2026-05-31',
      paid_by: 'you@example.com',
      min: 1.5,
      max: 20,
    });
  });

  it('drops malformed values from a hand-edited URL and keeps the valid ones', () => {
    expect(
      RecentSearchSchema.parse({
        q: 'Lidl',
        from: '01.05.2026',
        to: 20260531,
        min: 'abc',
        max: -5,
      }),
    ).toEqual({ q: 'Lidl' });
  });
});

describe('searchToFilters', () => {
  it('projects only the populated params', () => {
    expect(searchToFilters({ q: 'Lidl', min: 0, saved: 'x' })).toEqual({
      store: 'Lidl',
      amountMin: 0,
    });
  });

  it('counts populated filters', () => {
    expect(countActiveFilters(searchToFilters({ q: 'Lidl', from: '2026-05-01' }))).toBe(2);
  });
});
