import { describe, it, expect } from 'vitest';
import {
  makeStoreAliasKey,
  normalizeStoreName,
  storeAliasInputsFromMatch,
  storeNamesMatch,
} from './store-match';

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

describe('makeStoreAliasKey', () => {
  it('normalizes both sides into a stable key', () => {
    expect(makeStoreAliasKey('AMZN MKTP', "Amazon's")).toBe('amzn mktp|amazons');
  });

  it('is idempotent over already-normalized DB values', () => {
    const key = makeStoreAliasKey('AMZN Mktp', 'Amazon');
    expect(makeStoreAliasKey('amzn mktp', 'amazon')).toBe(key);
  });
});

describe('storeNamesMatch with aliases', () => {
  it('matches a learned pair that shares no token', () => {
    const aliases = new Set([makeStoreAliasKey('AMZN MKTP DE', 'Amazon')]);
    expect(storeNamesMatch('AMZN MKTP DE', null, 'Amazon')).toBe(false);
    expect(storeNamesMatch('AMZN MKTP DE', null, 'Amazon', aliases)).toBe(true);
  });

  it('matches via a raw-derived alias when merchant is null', () => {
    const aliases = new Set([makeStoreAliasKey('TGTG BERLIN 123', 'Too Good To Go')]);
    expect(storeNamesMatch(null, 'TGTG BERLIN 123', 'Too Good To Go', aliases)).toBe(true);
  });

  it('matches a store with no significant token through an alias (H&M case)', () => {
    const aliases = new Set([makeStoreAliasKey('HM BERLIN', 'H&M')]);
    expect(storeNamesMatch('HM BERLIN', null, 'H&M')).toBe(false);
    expect(storeNamesMatch('HM BERLIN', null, 'H&M', aliases)).toBe(true);
  });

  it('does not fire an alias for a different store', () => {
    const aliases = new Set([makeStoreAliasKey('AMZN MKTP DE', 'Amazon')]);
    expect(storeNamesMatch('AMZN MKTP DE', null, 'Lidl', aliases)).toBe(false);
  });
});

describe('storeAliasInputsFromMatch', () => {
  it('returns one input per distinct non-empty statement field', () => {
    expect(storeAliasInputsFromMatch('AMZN MKTP', 'AMZN MKTP DE BERLIN', 'Amazon')).toEqual([
      { statement_name: 'amzn mktp', receipt_store: 'amazon' },
      { statement_name: 'amzn mktp de berlin', receipt_store: 'amazon' },
    ]);
  });

  it('dedupes merchant and raw that normalize identically', () => {
    expect(storeAliasInputsFromMatch('AMZN MKTP', 'amzn mktp', 'Amazon')).toHaveLength(1);
  });

  it('uses raw alone when merchant is null', () => {
    expect(storeAliasInputsFromMatch(null, 'TGTG BERLIN', 'Too Good To Go')).toEqual([
      { statement_name: 'tgtg berlin', receipt_store: 'too good to go' },
    ]);
  });

  it('returns nothing when there is no usable name on either side', () => {
    expect(storeAliasInputsFromMatch(null, null, 'Lidl')).toEqual([]);
    expect(storeAliasInputsFromMatch('...', null, 'Lidl')).toEqual([]);
    expect(storeAliasInputsFromMatch('AMZN', null, '!!!')).toEqual([]);
  });
});
