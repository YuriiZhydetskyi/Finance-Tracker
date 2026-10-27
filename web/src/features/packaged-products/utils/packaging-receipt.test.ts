import { describe, expect, it } from 'vitest';
import { receiptImportFileName, receiptPagesLabel, storesLookAlike } from './packaging-receipt';

describe('receiptPagesLabel', () => {
  it('uses the singular for one page and the plural for several', () => {
    expect(receiptPagesLabel([1])).toBe('сторінки 1');
    expect(receiptPagesLabel([1, 2])).toBe('сторінок 1, 2');
  });
});

describe('receiptImportFileName', () => {
  it('names the source file and the pages that were cut out', () => {
    expect(receiptImportFileName('shopping.pdf', [1])).toBe('shopping — чек, стор. 1.pdf');
    expect(receiptImportFileName('Покупки.PDF', [1, 3])).toBe('Покупки — чек, стор. 1, 3.pdf');
  });

  it('copes with a source name that is empty after trimming', () => {
    expect(receiptImportFileName('  .pdf', [2])).toBe('чек — чек, стор. 2.pdf');
  });
});

describe('storesLookAlike', () => {
  it.each([
    ['REWE', 'REWE'],
    ['ALDI SÜD', 'Aldi Süd'],
    ['ALDI SÜD', 'Aldi Sud'],
    ['REWE', 'REWE Ahmad-Shah Hessami oHG'],
    ['Netto', 'Netto Marken-Discount'],
    ['EDEKA Straßfeld', 'edeka strassfeld'],
  ])('treats %s and %s as one shop', (a, b) => {
    expect(storesLookAlike(a, b)).toBe(true);
    expect(storesLookAlike(b, a)).toBe(true);
  });

  it.each([
    ['REWE', 'Aldi'],
    ['Kaufland', 'Kaufhof'],
    ['ALDI SÜD', 'ALDI Nord'],
    ['Lidl', ''],
  ])('keeps %s and %s apart', (a, b) => {
    expect(storesLookAlike(a, b)).toBe(false);
  });

  it('does not match on a stray one- or two-letter name', () => {
    expect(storesLookAlike('DM', 'DM Drogerie')).toBe(false);
    expect(storesLookAlike('DM', 'dm')).toBe(true);
  });
});
