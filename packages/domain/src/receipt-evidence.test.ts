import { describe, expect, it } from 'vitest';
import {
  amountAppearsInText,
  hasExplicitMultiplier,
  countPrintedArticles,
  hasWeightedQuantity,
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

  it('accepts the printed shapes seen on real receipts', () => {
    expect(hasExplicitMultiplier('Barilla Spaghetti 4 * 0,69 2,76 B', 4)).toBe(true);
    expect(hasExplicitMultiplier('But Plastik kaucja 3,000 x0,50 1,50', 3)).toBe(true);
    expect(hasExplicitMultiplier('Świeca zapłonowa 80,00 4.00 szt. 320,00', 4)).toBe(true);
    expect(hasExplicitMultiplier('EFECTA 95 CN27101245 (B)D(3) 22.09*6.86 151.54B', 22.09)).toBe(
      true,
    );
    expect(hasExplicitMultiplier('CukKonafettoLuzKg 0,358 x23,90 10,35C', 0.358)).toBe(true);
  });

  it('accepts the labelled quantity of order emails', () => {
    expect(hasExplicitMultiplier('Doppelherz Magnesium Menge: 2 EUR 15,98', 2)).toBe(true);
    expect(hasExplicitMultiplier('Bands Qty: 3', 3)).toBe(true);
    expect(hasExplicitMultiplier('Bands Menge: 12', 2)).toBe(false);
  });

  it('does not match a different quantity or a number that merely ends in the quantity', () => {
    expect(hasExplicitMultiplier('Barilla Spaghetti 4 * 0,69 2,76 B', 2)).toBe(false);
    expect(hasExplicitMultiplier('Milk 12 x 1,50', 2)).toBe(false);
    expect(hasExplicitMultiplier('Milk 2,50 x 1,50', 2)).toBe(false);
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

  it('accepts the fuel pump spellings of litres', () => {
    expect(hasWeightOrVolume("50,12 L'ter SAULENNUMMER 4 *Super SB 105,70 EUR*")).toBe(true);
    expect(hasWeightOrVolume('50,12 L’ter Super')).toBe(true);
    expect(hasWeightOrVolume('50,12 Liter Super')).toBe(true);
    expect(hasWeightOrVolume('50,12 Ltr Super')).toBe(true);
  });

  it('does not treat other words starting with l as a unit', () => {
    expect(hasWeightOrVolume('2 Lachs 4,99')).toBe(false);
  });
});

describe('hasWeightedQuantity', () => {
  it('accepts a unit or a quantity-times-price form', () => {
    expect(hasWeightedQuantity('Gouda mittelalt 0,229 kg 2,04 B', 0.229)).toBe(true);
    expect(hasWeightedQuantity('Mięso Cielę 2,400 x28,48 68,35C', 2.4)).toBe(true);
  });

  it('rejects a row with neither', () => {
    expect(hasWeightedQuantity('Gouda mittelalt 2,04 B', 0.229)).toBe(false);
  });
});

describe('countPrintedArticles', () => {
  const item = { product_name: 'Milk', qty: 1, unit_price_orig: 1.5, row_kind: 'item' };
  const returnedDeposit = {
    product_name: 'Pfand',
    qty: 1,
    unit_price_orig: -1.75,
    row_kind: 'deposit',
  };
  const chargedDeposit = {
    product_name: 'Pfand',
    qty: 2,
    unit_price_orig: 0.15,
    row_kind: 'deposit',
    qty_evidence: 'explicit_multiplier',
  };

  it('counts a priced row once and a multiplier row qty times', () => {
    const multiplied = { ...item, qty: 3, qty_evidence: 'explicit_multiplier' };
    expect(countPrintedArticles('Lidl', [item, multiplied])).toBe(4);
  });

  it('ignores discounts and refunds', () => {
    const discount = { ...item, unit_price_orig: -0.5, row_kind: 'discount' };
    expect(countPrintedArticles('Lidl', [item, discount])).toBe(1);
  });

  it('keeps counting charged deposit rows and skips returned ones outside Aldi', () => {
    expect(countPrintedArticles('EDEKA Straßfeld', [item, chargedDeposit, returnedDeposit])).toBe(
      3,
    );
  });

  it('counts returned deposit rows but not charged ones at Aldi', () => {
    expect(countPrintedArticles('ALDI SÜD', [item, chargedDeposit, returnedDeposit])).toBe(2);
    expect(countPrintedArticles('Aldi Süd', [item, returnedDeposit])).toBe(2);
  });

  it('does not treat other stores that merely contain the letters as Aldi', () => {
    expect(countPrintedArticles('Baldiweg Markt', [item, returnedDeposit])).toBe(1);
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
