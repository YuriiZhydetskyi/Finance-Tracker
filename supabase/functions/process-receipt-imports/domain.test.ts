import { describe, expect, it } from 'vitest';
import { prepareReceipt, validateBulkDocument } from './domain.ts';

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
});
