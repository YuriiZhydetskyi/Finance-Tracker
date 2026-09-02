import { describe, expect, it } from 'vitest';
import {
  auditReceiptEvidence,
  checkReceiptArticleCount,
  checkReceiptArithmetic,
  prepareReceipt,
  reassociateMisattachedMultiplier,
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

  it('uses the evidenced fiscal time instead of a separate payment time', () => {
    const result = validateBulkDocument({
      ...parsed,
      time: '14:06',
      fiscal_time: '14:05',
      fiscal_time_raw_text: 'Datum Uhrzeit Filiale Pos Bed Bon 02.05.26 14:05',
      payment_time: '14:06',
      payment_time_raw_text: 'Kundenbeleg Uhrzeit: 14:06:46 Uhr',
    });

    expect(result).toMatchObject({
      time: '14:05',
      time_source: 'fiscal_receipt',
      fiscal_time: '14:05',
      payment_time: '14:06',
    });
  });

  it('clears a structured time that has no matching printed evidence', () => {
    const result = validateBulkDocument({
      ...parsed,
      time: '14:06',
      fiscal_time: '14:05',
      fiscal_time_raw_text: 'Datum Uhrzeit Filiale Pos Bed Bon 02.05.26 14:04',
      payment_time: null,
      payment_time_raw_text: null,
    });

    expect(result.time).toBeNull();
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

  it('counts printed articles without treating refunds, discounts or weight as quantities', () => {
    const receipt = validateBulkDocument({
      ...parsed,
      total_orig: 3,
      total_raw_text: 'SUMME EUR 3,00',
      article_count: 4,
      article_count_raw_text: '4 Artikel',
      items: [
        {
          product_name: 'Milk',
          qty: 2,
          unit_price_orig: 1,
          source_ordinal: 1,
          raw_text: 'Milk 2 x 1,00 = 2,00',
          row_kind: 'item',
          qty_evidence: 'explicit_multiplier',
          printed_line_total_orig: 2,
        },
        {
          product_name: 'Apples',
          qty: 0.4,
          unit_price_orig: 2.5,
          source_ordinal: 2,
          raw_text: 'Apples 0,400 kg 2,50/kg 1,00',
          row_kind: 'item',
          qty_evidence: 'weight_or_volume',
          printed_line_total_orig: 1,
        },
        {
          product_name: 'Pfand',
          qty: 1,
          unit_price_orig: 0.25,
          source_ordinal: 3,
          raw_text: 'Pfand 0,25',
          row_kind: 'deposit',
          qty_evidence: 'implicit_one',
          printed_line_total_orig: 0.25,
        },
        {
          product_name: 'Pfand refund',
          qty: 1,
          unit_price_orig: -0.25,
          source_ordinal: 4,
          raw_text: 'Pfand -0,25',
          row_kind: 'refund',
          qty_evidence: 'implicit_one',
          printed_line_total_orig: -0.25,
        },
        {
          product_name: 'Cancelled',
          qty: 1,
          unit_price_orig: 2,
          source_ordinal: 5,
          raw_text: 'Cancelled 2,00',
          row_kind: 'item',
          qty_evidence: 'implicit_one',
          printed_line_total_orig: 2,
        },
        {
          product_name: 'Cancelled',
          qty: 1,
          unit_price_orig: -2,
          source_ordinal: 6,
          raw_text: 'Cancelled -2,00',
          row_kind: 'cancellation',
          qty_evidence: 'implicit_one',
          printed_line_total_orig: -2,
        },
      ],
    });

    expect(checkReceiptArticleCount(receipt)).toEqual({
      printedCount: 4,
      computedCount: 4,
      missingCount: 0,
      matches: true,
    });
    expect(auditReceiptEvidence(receipt)).toEqual({ ok: true, issues: [] });
  });

  it('rejects an article count that is not present in its verbatim evidence', () => {
    const evidence = auditReceiptEvidence(
      validateBulkDocument({
        ...parsed,
        total_raw_text: 'SUMME EUR 3,00',
        article_count: 22,
        article_count_raw_text: '21 Artikel',
        items: [],
      }),
    );

    expect(evidence.issues.map((issue) => issue.code)).toContain('article_count_evidence_mismatch');
  });

  it('reassociates an EDEKA between-row multiplier only when every independent gate becomes exact', () => {
    const receipt = validateBulkDocument({
      document_kind: 'receipt',
      classification_reason: 'EDEKA receipt',
      store: 'EDEKA Straßfeld',
      store_address: 'Aachener Str. 537, 50226 Frechen',
      date: '2026-07-01',
      time: '21:59',
      currency: 'EUR',
      total_orig: 15.27,
      total_raw_text: 'SUMME € 15,27',
      article_count: 8,
      article_count_raw_text: 'Posten: 8',
      items: [
        row('EIFEL Eier FLH', 1, 3.89, 1, 'EIFEL Eier FLH 3,89 A', 3.89),
        row(
          'Lie.Urk.Prot.Brot',
          2,
          1.79,
          2,
          'Lie.Urk.Prot.Brot 2,99 A / 2 x 1,79 €',
          2.99,
          'explicit_multiplier',
        ),
        row('Landl.Frischmilch', 1, 3.58, 3, 'Landl.Frischmilch 3,58 A', 3.58),
        row('Pfand', 2, 0.15, 4, 'Pfand 0,15 € x 2 0,30*A', 0.3, 'explicit_multiplier', {
          row_kind: 'deposit',
        }),
        row('Landl.Frischmilch', 1, -1.78, 5, 'Preisänderung -1,78', -1.78, 'implicit_one', {
          row_kind: 'discount',
        }),
        row('Lysell Deut.Kaviar', 1, 3.79, 6, 'Lysell Deut.Kaviar 3,79 A', 3.79),
        row('Marmorini Rose', 1, 4.99, 7, 'Marmorini Rose 4,99 A', 4.99),
        row('Marmorini Rose', 1, -2.49, 8, 'Preisänderung -2,49', -2.49, 'implicit_one', {
          row_kind: 'discount',
        }),
      ],
    });
    expect(auditReceiptEvidence(receipt).issues[0]?.message).toBe(
      'Позиція 2: 2.00 × 1.79 = 3.58, але в рядку надруковано 2.99.',
    );

    const repaired = reassociateMisattachedMultiplier(receipt);

    expect(repaired.applied).toBe(true);
    expect(repaired.parsed.items[1]).toMatchObject({
      product_name: 'Lie.Urk.Prot.Brot',
      qty: 1,
      unit_price_orig: 2.99,
      qty_evidence: 'implicit_one',
      raw_text: 'Lie.Urk.Prot.Brot 2,99 A',
    });
    expect(repaired.parsed.items[2]).toMatchObject({
      product_name: 'Landl.Frischmilch',
      qty: 2,
      unit_price_orig: 1.79,
      qty_evidence: 'explicit_multiplier',
      raw_text: '2 x 1,79 € / Landl.Frischmilch 3,58 A',
    });
    expect(checkReceiptArithmetic(repaired.parsed)).toMatchObject({
      computedTotal: 15.27,
      printedTotal: 15.27,
      matches: true,
    });
    expect(checkReceiptArticleCount(repaired.parsed)).toMatchObject({ matches: true });
    expect(auditReceiptEvidence(repaired.parsed)).toEqual({ ok: true, issues: [] });
  });

  it('does not move a multiplier when the reassociation is not a unique full-receipt solution', () => {
    const receipt = validateBulkDocument({
      ...parsed,
      total_orig: 8,
      total_raw_text: 'SUMME 8,00',
      items: [
        row('Bread', 2, 1.5, 1, 'Bread 2,00 / 2 x 1,50', 2, 'explicit_multiplier'),
        row('Milk', 1, 3, 2, 'Milk 3,00', 3),
      ],
    });

    const repaired = reassociateMisattachedMultiplier(receipt);

    expect(repaired.applied).toBe(false);
    expect(repaired.parsed).toBe(receipt);
  });
});

function row(
  productName: string,
  qty: number,
  unitPrice: number,
  ordinal: number,
  rawText: string,
  printedTotal: number,
  qtyEvidence: 'implicit_one' | 'explicit_multiplier' = 'implicit_one',
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    product_name: productName,
    product_code: null,
    qty,
    unit_price_orig: unitPrice,
    category_suggestion: null,
    discount_orig: 0,
    source_ordinal: ordinal,
    raw_text: rawText,
    row_kind: 'item',
    qty_evidence: qtyEvidence,
    printed_line_total_orig: printedTotal,
    tax_class: '1',
    ...extras,
  };
}
