import { describe, expect, it } from 'vitest';
import {
  parsePackagingImport,
  validatePackagingPages,
  validatePackagingLinks,
  matchesReceiptHint,
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
