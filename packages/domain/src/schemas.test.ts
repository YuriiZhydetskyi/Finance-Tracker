import { describe, it, expect } from 'vitest';
import {
  ItemSchema,
  ParsedReceiptSchema,
  ProductSchema,
  ReceiptSchema,
  type Item,
  type Receipt,
} from './schemas';

const validReceipt = (overrides: Partial<Receipt> = {}): Receipt => ({
  id: '01HM4N6RXX5K2P9F8DZ7QWERTY',
  date: '2026-05-04',
  store: 'Test Store',
  store_address: null,
  currency: 'EUR',
  total_orig: 5.49,
  fx_rate_eur: 1.0,
  total_eur: 5.49,
  paid_by: 'me@example.com',
  photo_url: null,
  photo_path: null,
  source: 'manual',
  raw_ocr_json: null,
  note: null,
  time: null,
  created_at: '2026-05-04T14:30:00.000Z',
  updated_at: '2026-05-04T14:30:00.000Z',
  ...overrides,
});

const validItem = (overrides: Partial<Item> = {}): Item => ({
  id: '01HM4N6RZZ7K2P9F8DZ7QWERAA',
  receipt_id: '01HM4N6RXX5K2P9F8DZ7QWERTY',
  product_id: null,
  product_name: 'Bread',
  store_product_code: null,
  category: 'Бакалія',
  qty: 1,
  unit_price_orig: 2.49,
  total_orig: 2.49,
  total_eur: 2.49,
  consumed_by: 'shared',
  note: null,
  wasted_qty: 0,
  wasted_at: null,
  discount_orig: 0,
  created_at: '2026-05-04T14:30:00.000Z',
  updated_at: '2026-05-04T14:30:00.000Z',
  ...overrides,
});

describe('ReceiptSchema', () => {
  it('accepts a valid receipt', () => {
    expect(() => ReceiptSchema.parse(validReceipt())).not.toThrow();
  });

  it('rejects bad date format', () => {
    expect(() => ReceiptSchema.parse(validReceipt({ date: '04.05.2026' }))).toThrow(/date/);
    expect(() => ReceiptSchema.parse(validReceipt({ date: '2026/05/04' }))).toThrow(/date/);
  });

  it('rejects non-ISO 4217 currency', () => {
    expect(() => ReceiptSchema.parse(validReceipt({ currency: 'eur' }))).toThrow(/currency/);
    expect(() => ReceiptSchema.parse(validReceipt({ currency: 'EURO' }))).toThrow(/currency/);
  });

  it('rejects bad source enum', () => {
    expect(() => ReceiptSchema.parse(validReceipt({ source: 'foo' as Receipt['source'] }))).toThrow(
      /source/,
    );
  });

  it('accepts all four source enum values', () => {
    for (const source of ['photo', 'manual', 'edit', 'manual-json'] as const) {
      expect(() => ReceiptSchema.parse(validReceipt({ source }))).not.toThrow();
    }
  });

  it('rejects email without @', () => {
    expect(() => ReceiptSchema.parse(validReceipt({ paid_by: 'noemailhere' }))).toThrow(/paid_by/);
  });

  it('rejects raw_ocr_json over 45000 chars (cell limit guard)', () => {
    const huge = 'x'.repeat(45_001);
    expect(() => ReceiptSchema.parse(validReceipt({ raw_ocr_json: huge }))).toThrow(/raw_ocr_json/);
  });

  it('rejects missing id', () => {
    expect(() => ReceiptSchema.parse(validReceipt({ id: '' }))).toThrow(/id/);
  });

  it('accepts store_address as freeform string or null', () => {
    expect(() =>
      ReceiptSchema.parse(validReceipt({ store_address: 'Hauptstr. 12, 80331 München' })),
    ).not.toThrow();
    expect(() => ReceiptSchema.parse(validReceipt({ store_address: null }))).not.toThrow();
  });

  it('accepts time only in canonical HH:MM:SS form (not HH:MM)', () => {
    expect(() => ReceiptSchema.parse(validReceipt({ time: '14:32:00' }))).not.toThrow();
    expect(() => ReceiptSchema.parse(validReceipt({ time: null }))).not.toThrow();
    // Loose HH:MM only allowed at the INPUT boundary, not on the canonical entity.
    expect(() => ReceiptSchema.parse(validReceipt({ time: '14:32' }))).toThrow(/time/);
  });
});

describe('ItemSchema', () => {
  it('accepts a valid item', () => {
    expect(() => ItemSchema.parse(validItem())).not.toThrow();
  });

  it('rejects qty <= 0', () => {
    expect(() => ItemSchema.parse(validItem({ qty: 0 }))).toThrow(/qty/);
    expect(() => ItemSchema.parse(validItem({ qty: -1 }))).toThrow(/qty/);
  });

  it('rejects wasted_qty > qty', () => {
    expect(() => ItemSchema.parse(validItem({ qty: 1, wasted_qty: 2 }))).toThrow(/wasted_qty/);
  });

  it('rejects bad consumed_by syntax', () => {
    expect(() => ItemSchema.parse(validItem({ consumed_by: 'foo' }))).toThrow(/consumed_by/);
  });

  it('rejects negative discount_orig', () => {
    expect(() => ItemSchema.parse(validItem({ discount_orig: -0.5 }))).toThrow(/discount_orig/);
  });

  it('rejects wasted_at non-null when wasted_qty is 0', () => {
    expect(() =>
      ItemSchema.parse(validItem({ wasted_qty: 0, wasted_at: '2026-05-18T10:00:00.000Z' })),
    ).toThrow(/wasted_at/);
  });

  it('rejects wasted_at null when wasted_qty > 0', () => {
    expect(() => ItemSchema.parse(validItem({ qty: 2, wasted_qty: 1, wasted_at: null }))).toThrow(
      /wasted_at/,
    );
  });

  it('accepts wasted_at + wasted_qty when both consistent', () => {
    expect(() =>
      ItemSchema.parse(validItem({ qty: 2, wasted_qty: 1, wasted_at: '2026-05-18T10:00:00.000Z' })),
    ).not.toThrow();
  });

  it('rejects discount_orig that exceeds unit_price_orig (positive price)', () => {
    expect(() =>
      ItemSchema.parse(
        validItem({
          unit_price_orig: 2.0,
          discount_orig: 2.5,
          total_orig: -1.0,
          total_eur: -1.0,
        }),
      ),
    ).toThrow(/discount_orig/);
  });

  it('accepts discount_orig with negative unit_price_orig (Pfand refund row)', () => {
    expect(() =>
      ItemSchema.parse(
        validItem({
          unit_price_orig: -8.25,
          discount_orig: 0,
          total_orig: -8.25,
          total_eur: -8.25,
        }),
      ),
    ).not.toThrow();
  });
});

describe('ProductSchema', () => {
  const validProduct = {
    id: '01HM4N6RPP3K2P9F8DZ7QWERTZ',
    name: 'Pesto Barilla 190g',
    store: 'Aldi',
    store_product_code: null,
    category: 'Бакалія',
    unit: 'g' as const,
    unit_size: 190,
    notes: null,
    created_at: '2026-05-04T14:30:00.000Z',
    updated_at: '2026-05-04T14:30:00.000Z',
  };

  it('accepts a valid product', () => {
    expect(() => ProductSchema.parse(validProduct)).not.toThrow();
  });

  it('rejects unknown unit', () => {
    expect(() => ProductSchema.parse({ ...validProduct, unit: 'oz' as unknown as 'g' })).toThrow();
  });

  it('accepts null unit (commodity)', () => {
    expect(() =>
      ProductSchema.parse({ ...validProduct, unit: null, unit_size: null }),
    ).not.toThrow();
  });
});

describe('ParsedReceiptSchema', () => {
  it('accepts a minimal AI output', () => {
    const parsed = ParsedReceiptSchema.parse({
      store: null,
      date: null,
      currency: 'EUR',
      total_orig: null,
      items: [],
    });
    expect(parsed.items).toHaveLength(0);
  });

  it('accepts items array with valid items', () => {
    const parsed = ParsedReceiptSchema.parse({
      store: 'EDEKA',
      date: '2026-05-04',
      currency: 'EUR',
      total_orig: 12.34,
      items: [
        {
          product_name: 'Bread',
          qty: 1,
          unit_price_orig: 1.99,
          category_suggestion: null,
        },
      ],
    });
    expect(parsed.items[0]?.product_name).toBe('Bread');
  });

  it('retains row and receipt evidence used by durable manual imports', () => {
    const parsed = ParsedReceiptSchema.parse({
      store: 'EDEKA',
      date: '2026-05-04',
      currency: 'EUR',
      total_orig: 1.99,
      total_raw_text: 'SUMME EUR 1,99',
      article_count: 1,
      article_count_raw_text: '1 Artikel',
      items: [
        {
          product_name: 'Bread',
          qty: 1,
          unit_price_orig: 1.99,
          category_suggestion: null,
          source_ordinal: 1,
          raw_text: 'Bread 1,99',
          row_kind: 'refund',
          qty_evidence: 'implicit_one',
          printed_line_total_orig: 1.99,
          tax_class: '1',
        },
      ],
    });

    expect(parsed).toMatchObject({
      total_raw_text: 'SUMME EUR 1,99',
      article_count: 1,
      article_count_raw_text: '1 Artikel',
      items: [
        {
          source_ordinal: 1,
          raw_text: 'Bread 1,99',
          row_kind: 'refund',
          qty_evidence: 'implicit_one',
          printed_line_total_orig: 1.99,
          tax_class: '1',
        },
      ],
    });
  });

  it('rejects bad currency', () => {
    expect(() =>
      ParsedReceiptSchema.parse({
        store: null,
        date: null,
        currency: 'eur',
        total_orig: null,
        items: [],
      }),
    ).toThrow(/currency/);
  });

  it('parses a snapshot WITHOUT store_address/time keys (backward compat)', () => {
    // raw_ocr_json snapshots written before these fields existed lack the keys;
    // optional+nullable means re-parsing must succeed.
    const parsed = ParsedReceiptSchema.parse({
      store: 'Old Store',
      date: '2025-01-01',
      currency: 'EUR',
      total_orig: 9.99,
      items: [],
    });
    expect(parsed.store_address).toBeUndefined();
    expect(parsed.time).toBeUndefined();
  });

  it('accepts time in HH:MM or HH:MM:SS from AI output', () => {
    expect(() =>
      ParsedReceiptSchema.parse({
        store: 'X',
        date: '2026-05-04',
        time: '14:32',
        currency: 'EUR',
        total_orig: 1,
        items: [],
      }),
    ).not.toThrow();
    expect(() =>
      ParsedReceiptSchema.parse({
        store: 'X',
        date: '2026-05-04',
        time: '14:32:05',
        currency: 'EUR',
        total_orig: 1,
        items: [],
      }),
    ).not.toThrow();
  });

  it('rejects items with non-positive qty', () => {
    expect(() =>
      ParsedReceiptSchema.parse({
        store: null,
        date: null,
        currency: 'EUR',
        total_orig: null,
        items: [
          {
            product_name: 'X',
            qty: 0,
            unit_price_orig: 1,
            category_suggestion: null,
          },
        ],
      }),
    ).toThrow(/qty/);
  });
});
