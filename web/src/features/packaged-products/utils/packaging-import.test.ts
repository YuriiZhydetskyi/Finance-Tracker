import { describe, expect, it } from 'vitest';
import {
  parsePackagingImport,
  validatePackagingPages,
  validatePackagingLinks,
  matchesReceiptHint,
  receiptHintsFromRawImport,
} from './packaging-import';
import type { PackagingCandidateRow } from '../types';

const context = { categories: ['Снеки'], taxonomy: { families: [], variants: [] }, existing: [] };
const product = { name: 'Pringles Original 165 г', category: 'Снеки', barcode: '5053990101658' };
function parse(value: unknown) {
  return parsePackagingImport(JSON.stringify(value), context);
}

describe('packaging document import contract', () => {
  it('keeps per-product page evidence and never derives a store link from array position', () => {
    const batch = parse({
      schema_version: 1,
      receipt_pages: [1],
      products: [
        { name: 'Paprika', category: 'Снеки', source_pages: [{ page: 2, kind: 'front' }] },
        {
          ...product,
          source_pages: [{ page: 3, kind: 'back' }],
          receipt_matches: [{ store: 'REWE', receipt_label: 'Originals', receipt_page: 1 }],
        },
      ],
    });
    expect(batch.products[1]?.source_pages).toEqual([{ page: 3, kind: 'back' }]);
    expect(batch.products.map((p) => p.link_product_ids)).toEqual([[], []]);
    expect(() => validatePackagingPages(batch, 3)).not.toThrow();
  });
  it.each([
    { source_pages: [{ page: 0, kind: 'front' }] },
    { source_pages: [{ page: 1.5, kind: 'front' }] },
    { source_pages: [{ page: 2, kind: 'source_pdf' }] },
    { source_pages: [{ page: 2, kind: 'front', crop: [0, 0, 1, 1] }] },
    {
      source_pages: [
        { page: 2, kind: 'front' },
        { page: 2, kind: 'back' },
      ],
    },
  ])('rejects invalid or ambiguous page references: %j', (evidence) => {
    expect(() => parse({ ...product, ...evidence })).toThrow();
  });
  it('rejects a receipt page used as packaging', () => {
    expect(() =>
      parse({
        receipt_pages: [1],
        products: [{ ...product, source_pages: [{ page: 1, kind: 'front' }] }],
      }),
    ).toThrow('позначена як чек');
  });
  it('rejects one page assigned to two different products', () => {
    const source_pages = [{ page: 2, kind: 'front' }];
    expect(() =>
      parse([
        { ...product, source_pages },
        { name: 'Paprika', category: 'Снеки', source_pages },
      ]),
    ).toThrow('Одна сторінка');
  });
  it('requires an actual PDF and validates page bounds', () => {
    const batch = parse({ ...product, source_pages: [{ page: 3, kind: 'front' }] });
    expect(() => validatePackagingPages(batch, null)).toThrow('Додай той самий PDF');
    expect(() => validatePackagingPages(batch, 2)).toThrow('якої немає');
  });
  it('keeps JSON-only legacy imports but refuses silently discarding an attached PDF', () => {
    const batch = parse(product);
    expect(() => validatePackagingPages(batch, null)).not.toThrow();
    expect(() => validatePackagingPages(batch, 4)).toThrow('source_pages');
  });
  it('reuses the exact existing barcode and leaves new metadata for review only', () => {
    const batch = parsePackagingImport(JSON.stringify(product), {
      ...context,
      existing: [{ id: 'old-card', name: 'Old name', barcode: product.barcode }],
    });
    expect(batch.products[0]?.existing_product_id).toBe('old-card');
  });
  it('detects duplicate barcodes after normalization and duplicate names without barcodes', () => {
    expect(() => parse([product, { ...product, barcode: '505 3990 101658' }])).toThrow(
      'повторюється',
    );
    expect(() =>
      parse([
        { name: 'Milk', category: 'Снеки' },
        { name: ' milk ', category: 'Снеки' },
      ]),
    ).toThrow('повторюється');
  });
  it('does not accept impossible nutrition before starting PDF work', () => {
    expect(() =>
      parse({ ...product, nutrition_basis: 'per_100_g', fat_g: 3, saturated_fat_g: 50 }),
    ).toThrow();
  });
  it('blocks assigning a store row to two products', () => {
    const batch = parse([product, { name: 'Milk', category: 'Снеки' }]);
    for (const p of batch.products) p.link_product_ids = ['store-row'];
    expect(() => validatePackagingLinks(batch.products)).toThrow('двох товарів');
  });
  describe('review_notes', () => {
    it.each([
      ['absent', {}],
      ['null', { review_notes: null }],
      ['empty', { review_notes: [] }],
    ])('means nothing to check when %s', (_name, extra) => {
      expect(parse({ ...product, ...extra }).products[0]?.parsed.review_notes).toEqual([]);
    });
    it('keeps trimmed notes per product and tolerates unknown extra fields', () => {
      const batch = parse([
        {
          ...product,
          review_notes: ['  Штрихкод розмитий ', 'Збіг із чеком неоднозначний'],
          confidence: 'low',
        },
        { name: 'Paprika', category: 'Снеки' },
      ]);
      expect(batch.products[0]?.parsed.review_notes).toEqual([
        'Штрихкод розмитий',
        'Збіг із чеком неоднозначний',
      ]);
      expect(batch.products[1]?.parsed.review_notes).toEqual([]);
    });
    it('keeps the original object for the audit payload', () => {
      const raw = { ...product, review_notes: ['  Штрихкод розмитий '] };
      expect(parse(raw).products[0]?.raw).toEqual(raw);
    });
    it('names the product when the notes break the contract', () => {
      expect(() =>
        parse({
          ...product,
          review_notes: Array.from({ length: 11 }, (_, i) => `Причина ${String(i)}`),
        }),
      ).toThrow(/Товар 1.*review_notes/);
      expect(() => parse({ ...product, review_notes: ['я'.repeat(301)] })).toThrow('review_notes');
    });
    it('does not change which existing card is reused', () => {
      const batch = parsePackagingImport(
        JSON.stringify({ ...product, review_notes: ['Нова причина'] }),
        { ...context, existing: [{ id: 'old-card', name: 'Old name', barcode: product.barcode }] },
      );
      expect(batch.products[0]?.existing_product_id).toBe('old-card');
      expect(batch.products[0]?.parsed.review_notes).toEqual(['Нова причина']);
    });
  });
  describe('attributes', () => {
    const apple = { Сорт: 'Jonagold', Калібр: '65–70 мм' };

    it.each([
      ['absent', {}],
      ['null', { attributes: null }],
      ['empty', { attributes: {} }],
    ])('means nothing recorded when %s', (_name, extra) => {
      expect(parse({ ...product, ...extra }).products[0]?.parsed.attributes).toEqual({});
    });
    it('keeps trimmed pairs per product and tolerates unknown extra fields', () => {
      const batch = parse([
        {
          ...product,
          attributes: { ' Сорт ': ' Jonagold ', Калібр: '65–70 мм' },
          confidence: 'low',
        },
        { name: 'Paprika', category: 'Снеки' },
      ]);
      expect(batch.products[0]?.parsed.attributes).toEqual(apple);
      expect(batch.products[1]?.parsed.attributes).toEqual({});
    });
    it('keeps the original object for the audit payload', () => {
      const raw = { ...product, attributes: { ' Сорт ': ' Jonagold ' } };
      expect(parse(raw).products[0]?.raw).toEqual(raw);
    });
    it('names the product and the field when the pairs break the contract', () => {
      expect(() =>
        parse({
          ...product,
          attributes: Object.fromEntries(
            Array.from({ length: 16 }, (_, i) => [`Ключ ${String(i)}`, 'значення']),
          ),
        }),
      ).toThrow(/Товар 1.*attributes/);
      expect(() => parse({ ...product, attributes: { Сорт: 'я'.repeat(301) } })).toThrow(
        'attributes.Сорт',
      );
      expect(() => parse({ ...product, attributes: { Bio: true } })).toThrow('attributes');
    });
    it('does not change which existing card is reused', () => {
      const batch = parsePackagingImport(JSON.stringify({ ...product, attributes: apple }), {
        ...context,
        existing: [{ id: 'old-card', name: 'Old name', barcode: product.barcode }],
      });
      expect(batch.products[0]?.existing_product_id).toBe('old-card');
      expect(batch.products[0]?.parsed.attributes).toEqual(apple);
    });
  });
  describe('receiptHintsFromRawImport', () => {
    const hint = { store: 'REWE', receipt_label: 'Originals', receipt_date: '2026-09-13' };

    it('reads the hints back from the stored import payload', () => {
      expect(
        receiptHintsFromRawImport({
          product: { name: 'Pringles', receipt_matches: [hint] },
          source: { file_name: 'a.pdf' },
        }),
      ).toEqual([hint]);
    });
    it('skips a hint that no longer fits the contract, keeps the rest', () => {
      expect(
        receiptHintsFromRawImport({
          product: { receipt_matches: [{ store: '', receipt_label: 'x' }, hint, 'REWE'] },
        }),
      ).toEqual([hint]);
    });
    it.each([
      [null],
      [undefined],
      ['text'],
      [{}],
      [{ product: null }],
      [{ product: {} }],
      [{ product: { receipt_matches: 'x' } }],
    ])('returns nothing for %j', (raw) => {
      expect(receiptHintsFromRawImport(raw)).toEqual([]);
    });
  });
  describe('receipt summary', () => {
    const withReceipt = (receipt: unknown) =>
      parse({
        receipt_pages: [1],
        receipt,
        products: [{ ...product, source_pages: [{ page: 2, kind: 'front' }] }],
      });

    it('is optional', () => {
      expect(parse({ receipt_pages: [1], products: [product] }).receipt).toBeNull();
      expect(withReceipt(null).receipt).toBeNull();
      expect(withReceipt({}).receipt).toBeNull();
    });
    it('keeps what the transcriber read and fills the rest with null', () => {
      expect(withReceipt({ store: ' REWE ', date: '2026-09-13', total: 23.45 }).receipt).toEqual({
        store: 'REWE',
        date: '2026-09-13',
        total: 23.45,
        currency: null,
      });
      expect(withReceipt({ store: null, date: null, total: 5, currency: 'EUR' }).receipt).toEqual({
        store: null,
        date: null,
        total: 5,
        currency: 'EUR',
      });
    });
    it('tolerates unknown extra keys', () => {
      expect(withReceipt({ store: 'REWE', cashier: 'Anna' }).receipt?.store).toBe('REWE');
    });
    it.each([
      ['a date that is not a date', { date: '13.09.2026' }],
      ['a non-numeric total', { total: '23,45' }],
      ['a zero total', { total: 0 }],
      ['a lower-case currency', { currency: 'eur' }],
      ['a receipt that is not an object', 'REWE'],
    ])('rejects %s before any PDF work', (_name, receipt) => {
      expect(() => withReceipt(receipt)).toThrow(/receipt/);
    });
  });
  it('a nearby date alone cannot suggest an unrelated store label', () => {
    const row = {
      store: 'REWE',
      product_name: 'Originals',
      receipt_labels: [],
      store_product_code: null,
      last_purchased_on: '2026-09-13',
    } as unknown as PackagingCandidateRow;
    expect(
      matchesReceiptHint(row, [
        { store: 'REWE', receipt_label: 'Milk', receipt_date: '2026-09-13' },
      ]),
    ).toBe(false);
    expect(
      matchesReceiptHint(row, [
        { store: 'rewe', receipt_label: ' Originals ', receipt_date: '2026-01-01' },
      ]),
    ).toBe(true);
    expect(matchesReceiptHint(row, [{ store: 'Aldi', receipt_label: 'Originals' }])).toBe(false);
  });
});
