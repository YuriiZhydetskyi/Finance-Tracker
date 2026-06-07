import { describe, it, expect } from 'vitest';
import { normalizeStoreName, storeNamesMatch } from './store-match';

describe('normalizeStoreName', () => {
  it('lowercases, strips punctuation and diacritics, collapses whitespace', () => {
    expect(normalizeStoreName("McDonald's")).toBe('mcdonalds');
    expect(normalizeStoreName('Café  Möhren')).toBe('cafe mohren');
    expect(normalizeStoreName('LIDL   SAGT  DANKE')).toBe('lidl sagt danke');
  });
});

describe('storeNamesMatch', () => {
  it('matches when a significant token is shared (merchant)', () => {
    expect(storeNamesMatch('MCDONALDS 123 BERLIN', null, "McDonald's")).toBe(true);
  });

  it('matches via the raw description when merchant is null', () => {
    expect(storeNamesMatch(null, 'LIDL DIENSTLEISTUNG SAGT DANKE', 'Lidl')).toBe(true);
  });

  it('does not match unrelated stores', () => {
    expect(storeNamesMatch('REWE', null, 'Lidl')).toBe(false);
  });

  it('returns false when there is nothing to compare', () => {
    expect(storeNamesMatch(null, null, 'Lidl')).toBe(false);
  });

  it('ignores short noise tokens (store numbers, 2-letter words)', () => {
    // "12" and store number share no ≥3-char token with "Lidl"
    expect(storeNamesMatch('12 34', null, 'Lidl')).toBe(false);
  });
});
