import { describe, expect, it } from 'vitest';
import {
  auditReceiptEvidence,
  checkReceiptArithmetic,
  prepareReceipt,
  validateBulkDocument,
} from './domain.ts';

const parsed = validateBulkDocument({
  document_kind: 'receipt',
  classification_reason: 'Cash receipt',
  store: 'Lidl',
  store_address: null,
  date: '2026-08-01',
  time: '12:30',
  currency: 'EUR',
  total_orig: 3,
  items: [
    {
      product_name: 'Milk',
      qty: 2,
      unit_price_orig: 1.5,
      category_suggestion: null,
      product_code: null,
    },
  ],
});

describe('bulk import domain gate', () => {
  it('defaults unknown categories to Інше and prepares consistent receipts', () => {
    let counter = 0;
    const result = prepareReceipt(
      parsed,
      1,
      new Set(['Інше']),
      () => `${counter++}`.padEnd(26, 'A'),
      null,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items[0]?.category).toBe('Інше');
    expect(result.value.receipt.total_orig).toBe(3);
  });

  it('routes inconsistent totals to review', () => {
    const result = prepareReceipt(
      { ...parsed, total_orig: 9 },
      1,
      new Set(['Інше']),
      () => '0'.repeat(26),
      null,
    );
    expect(result.ok).toBe(false);
  });

  it('accepts a non-receipt classification without validating irrelevant item guesses', () => {
    const result = validateBulkDocument({
      document_kind: 'not_receipt',
      classification_reason: 'Unpaid invoice',
      store: null,
      date: null,
      currency: 'EUR',
      total_orig: null,
      items: [{ malformed: true }],
    });
    expect(result.document_kind).toBe('not_receipt');
    expect(result.items).toEqual([]);
  });

  it('rejects impossible dates before the database transaction', () => {
    const result = prepareReceipt(
      { ...parsed, date: '2026-02-31' },
      1,
      new Set(['Інше']),
      () => '0'.repeat(26),
      null,
    );
    expect(result.ok).toBe(false);
  });

  it('pairs repeated same-name discounts one-to-one without corrupting a correct 16.02 extraction', () => {
    const repeatedDiscounts = validateBulkDocument({
      ...parsed,
      total_orig: 16.02,
      items: [
        { product_name: 'Lamm', qty: 1, unit_price_orig: 6.16 },
        { product_name: 'Lamm', qty: 1, unit_price_orig: -1.85 },
        { product_name: 'Lamm', qty: 1, unit_price_orig: 5.64 },
        { product_name: 'Lamm', qty: 1, unit_price_orig: -1.7 },
        { product_name: 'Käse', qty: 1, unit_price_orig: 1.79 },
        { product_name: 'Käse', qty: 1, unit_price_orig: -0.54 },
        { product_name: 'Käse', qty: 1, unit_price_orig: 1.79 },
        { product_name: 'Käse', qty: 1, unit_price_orig: -0.54 },
        { product_name: 'Other', qty: 1, unit_price_orig: 5.27 },
      ],
    });

    const arithmetic = checkReceiptArithmetic(repeatedDiscounts);
    expect(arithmetic).toMatchObject({ computedTotal: 16.02, printedTotal: 16.02, matches: true });
    expect(arithmetic?.normalizedItems).toEqual([
      expect.objectContaining({ product_name: 'Lamm', unit_price_orig: 6.16, discount_orig: 1.85 }),
      expect.objectContaining({ product_name: 'Lamm', unit_price_orig: 5.64, discount_orig: 1.7 }),
      expect.objectContaining({ product_name: 'Käse', unit_price_orig: 1.79, discount_orig: 0.54 }),
      expect.objectContaining({ product_name: 'Käse', unit_price_orig: 1.79, discount_orig: 0.54 }),
      expect.objectContaining({ product_name: 'Other', unit_price_orig: 5.27 }),
    ]);

    const prepared = prepareReceipt(
      repeatedDiscounts,
      1,
      new Set(['Інше']),
      () => '0'.repeat(26),
      null,
    );
    expect(prepared.ok).toBe(true);
  });

  it('claims each positive row at most once across repeated exact cancellations', () => {
    const cancellations = validateBulkDocument({
      ...parsed,
      total_orig: 0,
      items: [
        { product_name: 'Void\u200B item', qty: 1, unit_price_orig: 5 },
        { product_name: 'Void item', qty: 1, unit_price_orig: 5 },
        { product_name: 'Void item', qty: 1, unit_price_orig: -5 },
        { product_name: 'Void item', qty: 1, unit_price_orig: -5 },
      ],
    });

    const arithmetic = checkReceiptArithmetic(cancellations);
    expect(arithmetic).toMatchObject({ computedTotal: 0, matches: true });
    expect(arithmetic?.normalizedItems).toHaveLength(2);
    expect(arithmetic?.normalizedItems.every((item) => item.unit_price_orig === 0)).toBe(true);
  });

  it('does not hide a missing low-value row behind a percentage tolerance', () => {
    const arithmetic = checkReceiptArithmetic(
      validateBulkDocument({
        ...parsed,
        total_orig: 100,
        items: [{ product_name: 'Basket', qty: 1, unit_price_orig: 99.6 }],
      }),
    );

    expect(arithmetic).toMatchObject({ tolerance: 0.02, matches: false });
  });

  it('requires visible evidence for quantities and exact row ordering', () => {
    const evidence = auditReceiptEvidence(
      validateBulkDocument({
        ...parsed,
        total_raw_text: 'SUMME EUR 3,00',
        items: [
          {
            product_name: 'Milk',
            qty: 2,
            unit_price_orig: 1.5,
            source_ordinal: 2,
            raw_text: 'Milk 1,50 2',
            row_kind: 'item',
            qty_evidence: 'implicit_one',
            printed_line_total_orig: 3,
            tax_class: '2',
          },
        ],
      }),
    );

    expect(evidence.ok).toBe(false);
    expect(evidence.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['unsupported_quantity', 'invalid_row_order']),
    );
  });

  it('accepts an explicit multiplier whose line total and final total are evidenced', () => {
    const evidence = auditReceiptEvidence(
      validateBulkDocument({
        ...parsed,
        total_raw_text: 'SUMME EUR 3,00',
        items: [
          {
            product_name: 'Milk',
            qty: 2,
            unit_price_orig: 1.5,
            source_ordinal: 1,
            raw_text: 'Milk 2 x 1,50 = 3,00',
            row_kind: 'item',
            qty_evidence: 'explicit_multiplier',
            printed_line_total_orig: 3,
            tax_class: '1',
          },
        ],
      }),
    );

    expect(evidence).toEqual({ ok: true, issues: [] });
  });
});
