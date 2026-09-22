import { describe, expect, it } from 'vitest';
import {
  amountAppearsInText,
  hasExplicitMultiplier,
  hasWeightOrVolume,
  integerAppearsInText,
  mergeAccountingPairs,
  normalizeReceiptText,
  type AccountingLine,
} from './receipt-evidence';

describe('normalizeReceiptText', () => {
  it('strips invisible characters, collapses whitespace and lowercases', () => {
    expect(normalizeReceiptText('  Void\u200B   ITEM\uFEFF ')).toBe('void item');
  });

  it('applies NFKC so compatibility forms compare equal', () => {
    expect(normalizeReceiptText('Ｍｉｌｋ')).toBe('milk');
  });
});

describe('amountAppearsInText', () => {
  it('matches dot and comma decimal variants ignoring whitespace', () => {
    expect(amountAppearsInText('SUMME EUR 3,00', 3)).toBe(true);
    expect(amountAppearsInText('TOTAL 3.00', 3)).toBe(true);
    expect(amountAppearsInText('SUMME EUR 1 234,50', 1234.5)).toBe(true);
  });

  it('matches the absolute value of negative amounts', () => {
    expect(amountAppearsInText('Leergut -0,50', -0.5)).toBe(true);
  });

  it('rejects an amount that is not printed', () => {
    expect(amountAppearsInText('SUMME EUR 3,01', 3)).toBe(false);
  });
});

describe('integerAppearsInText', () => {
  it('matches a standalone integer', () => {
    expect(integerAppearsInText('1 Artikel', 1)).toBe(true);
    expect(integerAppearsInText('Artikel: 12', 12)).toBe(true);
  });

  it('does not match the integer as part of a longer number', () => {
    expect(integerAppearsInText('12 Artikel', 1)).toBe(false);
  });
});

describe('hasExplicitMultiplier', () => {
  it('accepts "qty x" and "x qty" multiplier forms', () => {
    expect(hasExplicitMultiplier('Milk 2 x 1,50 = 3,00', 2)).toBe(true);
    expect(hasExplicitMultiplier('Milk x 2', 2)).toBe(true);
    expect(hasExplicitMultiplier('Milk 3 Stk. 1,50', 3)).toBe(true);
  });

  it('accepts decimal quantities with a comma', () => {
    expect(hasExplicitMultiplier('Äpfel 0,5 x 2,00', 0.5)).toBe(true);
  });

  it('rejects a bare number without a multiplier marker', () => {
    expect(hasExplicitMultiplier('Milk 1,50 2', 2)).toBe(false);
  });
});

describe('hasWeightOrVolume', () => {
  it('detects weight and volume units', () => {
    expect(hasWeightOrVolume('Bananen 1,234 kg')).toBe(true);
    expect(hasWeightOrVolume('Wasser 1,5 l')).toBe(true);
    expect(hasWeightOrVolume('Käse 200 g')).toBe(true);
  });

  it('ignores rows without a unit', () => {
    expect(hasWeightOrVolume('Milk 2 x 1,50')).toBe(false);
  });
});

describe('mergeAccountingPairs', () => {
  it('pairs repeated same-name discounts one-to-one', () => {
    const items: AccountingLine[] = [
      { product_name: 'Lamm', qty: 1, unit_price_orig: 6.16 },
      { product_name: 'Lamm', qty: 1, unit_price_orig: -1.85 },
      { product_name: 'Lamm', qty: 1, unit_price_orig: 5.64 },
      { product_name: 'Lamm', qty: 1, unit_price_orig: -1.7 },
      { product_name: 'Käse', qty: 1, unit_price_orig: 1.79 },
      { product_name: 'Käse', qty: 1, unit_price_orig: -0.54 },
      { product_name: 'Käse', qty: 1, unit_price_orig: 1.79 },
      { product_name: 'Käse', qty: 1, unit_price_orig: -0.54 },
      { product_name: 'Other', qty: 1, unit_price_orig: 5.27 },
    ];

    expect(mergeAccountingPairs(items)).toEqual([
      { product_name: 'Lamm', qty: 1, unit_price_orig: 6.16, discount_orig: 1.85 },
      { product_name: 'Lamm', qty: 1, unit_price_orig: 5.64, discount_orig: 1.7 },
      { product_name: 'Käse', qty: 1, unit_price_orig: 1.79, discount_orig: 0.54 },
      { product_name: 'Käse', qty: 1, unit_price_orig: 1.79, discount_orig: 0.54 },
      { product_name: 'Other', qty: 1, unit_price_orig: 5.27 },
    ]);
  });

  it('claims each positive row at most once across repeated exact cancellations', () => {
    const merged = mergeAccountingPairs([
      { product_name: 'Void\u200B item', qty: 1, unit_price_orig: 5 },
      { product_name: 'Void item', qty: 1, unit_price_orig: 5 },
      { product_name: 'Void item', qty: 1, unit_price_orig: -5 },
      { product_name: 'Void item', qty: 1, unit_price_orig: -5 },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged).toEqual([
      { product_name: 'Void\u200B item', qty: 1, unit_price_orig: 0, discount_orig: 0 },
      { product_name: 'Void item', qty: 1, unit_price_orig: 0, discount_orig: 0 },
    ]);
  });

  it('prefers an exact cancellation over a partial discount', () => {
    const merged = mergeAccountingPairs([
      { product_name: 'Bread', qty: 1, unit_price_orig: 3 },
      { product_name: 'Bread', qty: 1, unit_price_orig: 2 },
      { product_name: 'Bread', qty: 1, unit_price_orig: -2 },
    ]);

    expect(merged).toEqual([
      { product_name: 'Bread', qty: 1, unit_price_orig: 3 },
      { product_name: 'Bread', qty: 1, unit_price_orig: 0, discount_orig: 0 },
    ]);
  });

  it('does not pair rows with different quantities or names', () => {
    const items: AccountingLine[] = [
      { product_name: 'Milk', qty: 2, unit_price_orig: 1.5 },
      { product_name: 'Milk', qty: 1, unit_price_orig: -0.5 },
      { product_name: 'Leergut', qty: 1, unit_price_orig: -0.25 },
    ];

    expect(mergeAccountingPairs(items)).toEqual(items);
  });

  it('does not mutate the input array', () => {
    const items: AccountingLine[] = [
      { product_name: 'Milk', qty: 1, unit_price_orig: 1.5 },
      { product_name: 'Milk', qty: 1, unit_price_orig: -1.5 },
    ];
    const snapshot = structuredClone(items);

    mergeAccountingPairs(items);

    expect(items).toEqual(snapshot);
  });

  it('preserves extra fields of the concrete item type', () => {
    const merged = mergeAccountingPairs([
      { product_name: 'Milk', qty: 1, unit_price_orig: 2, source_ordinal: 1 },
      { product_name: 'Milk', qty: 1, unit_price_orig: -0.5, source_ordinal: 2 },
    ]);

    expect(merged).toEqual([
      { product_name: 'Milk', qty: 1, unit_price_orig: 2, discount_orig: 0.5, source_ordinal: 1 },
    ]);
  });
});
