import { describe, expect, it } from 'vitest';
import { mergeKnownStores } from './known-stores.ts';

describe('mergeKnownStores', () => {
  it('merges registry and chain rows into one sorted list without duplicates', () => {
    expect(
      mergeKnownStores(
        [{ canonical_name: 'EDEKA Musterstadt' }, { canonical_name: 'Netto' }],
        [{ canonical_name: 'ALDI SÜD' }, { canonical_name: 'Netto' }, { canonical_name: 'REWE' }],
      ),
    ).toEqual(['ALDI SÜD', 'EDEKA Musterstadt', 'Netto', 'REWE']);
  });

  it('drops blank names and tolerates a failed lookup', () => {
    expect(
      mergeKnownStores(null, undefined, [{ canonical_name: '  ' }, { canonical_name: ' Lidl ' }]),
    ).toEqual(['Lidl']);
  });

  it('returns nothing when there is nothing to merge', () => {
    expect(mergeKnownStores()).toEqual([]);
  });
});
