import { describe, expect, it } from 'vitest';
import type { BulkParsedDocument, ParsedItem } from '../parse-receipt/types.ts';
import { validateBulkDocument } from './domain.ts';
import {
  reconcileIndependentReceipt,
  selectParseProviderRole,
  selectSeedStages,
  selectVerificationProviderRole,
  shouldLoadStoredVerificationSeed,
  shouldQueueIndependentCheck,
} from './receipt-reconciliation.ts';

function row(
  ordinal: number,
  productName: string,
  qty: number,
  price: number,
  rawText = `${productName} ${price.toFixed(2)}`,
  extras: Partial<ParsedItem> = {},
): ParsedItem {
  return {
    product_name: productName,
    qty,
    unit_price_orig: price,
    category_suggestion: null,
    source_ordinal: ordinal,
    raw_text: rawText,
    row_kind: 'item',
    qty_evidence: qty === 1 ? 'implicit_one' : 'explicit_multiplier',
    printed_line_total_orig: Math.round(qty * price * 100) / 100,
    tax_class: null,
    ...extras,
  };
}

function receipt(total: number, items: ParsedItem[]): BulkParsedDocument {
  return validateBulkDocument({
    document_kind: 'receipt',
    classification_reason: 'Cash receipt',
    store: 'dm-drogerie markt',
    store_address: 'Example 1',
    date: '2026-08-01',
    time: '11:45',
    currency: 'EUR',
    total_orig: total,
    total_raw_text: `SUMME EUR ${total.toFixed(2).replace('.', ',')}`,
    items,
  });
}

describe('independent receipt reconciliation', () => {
  it('uses Sonnet only after Gemini and stops after an Anthropic result', () => {
    expect([1, 2, 3].map(selectParseProviderRole)).toEqual(['primary', 'fallback', 'fallback']);
    expect(selectVerificationProviderRole('gemini')).toBe('fallback');
    expect(selectVerificationProviderRole('anthropic')).toBeNull();
  });

  it('starts a manual requeue fresh and reuses seeds only on the same message retry', () => {
    expect(shouldLoadStoredVerificationSeed(1)).toBe(false);
    expect(shouldLoadStoredVerificationSeed(2)).toBe(true);
    expect(shouldLoadStoredVerificationSeed(3)).toBe(true);
  });

  it('replays a reviewed file from its base parse but continues an active escalation', () => {
    expect(selectSeedStages('validation')).toEqual(['primary_parse', 'fallback_parse']);
    expect(selectSeedStages('independent_check_required')).toEqual([
      'primary_parse',
      'fallback_parse',
      'independent_check',
    ]);
  });

  it('queues only a mismatching Gemini parse for independent Sonnet verification', () => {
    expect(shouldQueueIndependentCheck('primary', 1, false, true)).toBe(true);
    expect(shouldQueueIndependentCheck('fallback', 2, true, false)).toBe(false);
    expect(shouldQueueIndependentCheck('primary', 3, false, true)).toBe(false);
    expect(shouldQueueIndependentCheck('primary', 1, true, true)).toBe(false);
  });

  it('diagnoses a dm VAT class read as quantity and accepts only the evidenced parse', () => {
    const primary = receipt(27.5, [
      row(1, 'A', 2, 2.25, 'A 2,25 2', {
        qty_evidence: 'implicit_one',
        tax_class: '2',
        printed_line_total_orig: 2.25,
      }),
      row(2, 'B', 2, 3.95, 'B 3,95 2', {
        qty_evidence: 'implicit_one',
        tax_class: '2',
        printed_line_total_orig: 3.95,
      }),
      row(3, 'C', 2, 3.45, 'C 3,45 2', {
        qty_evidence: 'implicit_one',
        tax_class: '2',
        printed_line_total_orig: 3.45,
      }),
      row(4, 'Other', 1, 17.85),
    ]);
    const secondary = receipt(27.5, [
      row(1, 'A', 1, 2.25, 'A 2,25 2', { tax_class: '2' }),
      row(2, 'B', 1, 3.95, 'B 3,95 2', { tax_class: '2' }),
      row(3, 'C', 1, 3.45, 'C 3,45 2', { tax_class: '2' }),
      row(4, 'Other', 1, 17.85),
    ]);

    const result = reconcileIndependentReceipt(primary, secondary);

    expect(result).toMatchObject({
      status: 'accepted',
      diagnosisCode: 'tax_class_as_quantity',
      before: { computedTotal: 37.15, matches: false },
      after: { computedTotal: 27.5, matches: true },
    });
    expect(result.parsed.items.slice(0, 3).map((item) => item.qty)).toEqual([1, 1, 1]);
  });

  it('diagnoses an independently recovered repeated row', () => {
    const primary = receipt(43.14, [row(1, 'Other', 1, 39.16), row(2, 'Cashews', 1, 1.99)]);
    const secondary = receipt(43.14, [
      row(1, 'Other', 1, 39.16),
      row(2, 'Cashews', 1, 1.99),
      row(3, 'Cashews', 1, 1.99),
    ]);

    const result = reconcileIndependentReceipt(primary, secondary);

    expect(result).toMatchObject({
      status: 'accepted',
      diagnosisCode: 'missing_repeated_row',
      before: { computedTotal: 41.15, matches: false },
      after: { computedTotal: 43.14, matches: true },
    });
  });

  it('accepts one independently evidenced repeated row without copying other secondary errors', () => {
    const primary = receipt(101.18, [
      row(1, 'Basket', 1, 98),
      row(2, 'Ultje Erdnusse', 1, 1.59, '769560 Ultje Erdnusse 1,59 A', {
        product_code: '769560',
      }),
    ]);
    const secondary = receipt(101.18, [
      row(1, 'Basket', 1, 94.81),
      row(2, 'Ültje Erdnüsse', 1, 1.59, '769560 Ültje Erdnüsse 1,59 A', {
        product_code: '769560',
      }),
      row(3, 'Ültje Erdnüsse', 1, 1.59, '769560 Ültje Erdnüsse 1,59 A', {
        product_code: '769560',
      }),
    ]);

    const result = reconcileIndependentReceipt(primary, secondary);

    expect(result).toMatchObject({
      status: 'accepted',
      diagnosisCode: 'missing_repeated_row',
      before: { computedTotal: 99.59, matches: false },
      after: { computedTotal: 101.18, matches: true },
      details: {
        targeted_repair: {
          product_name: 'Ultje Erdnusse',
          product_code: '769560',
          primary_occurrences: 1,
          secondary_occurrences: 2,
          line_total: 1.59,
          primary_gap: 1.59,
          secondary_computed_total: 97.99,
        },
      },
    });
    expect(result.parsed.items.map((item) => item.product_name)).toEqual([
      'Basket',
      'Ultje Erdnusse',
      'Ultje Erdnusse',
    ]);
    expect(result.parsed.items[0]!.unit_price_orig).toBe(98);
  });

  it('does not add a repeated row when the independent model did not see another occurrence', () => {
    const rows = [row(1, 'Basket', 1, 39.16), row(2, 'Cashews', 1, 1.99)];
    const primary = receipt(43.14, rows);
    const secondary = receipt(43.14, rows);

    expect(reconcileIndependentReceipt(primary, secondary)).toMatchObject({
      status: 'rejected',
      diagnosisCode: 'secondary_arithmetic_mismatch',
    });
  });

  it('fails closed when the independent extraction still has wrong arithmetic', () => {
    const primary = receipt(101.18, [row(1, 'Basket', 1, 99.59)]);
    const secondary = receipt(101.18, [row(1, 'Basket', 1, 100)]);

    const result = reconcileIndependentReceipt(primary, secondary);

    expect(result).toMatchObject({
      status: 'rejected',
      diagnosisCode: 'secondary_arithmetic_mismatch',
      parsed: primary,
    });
  });

  it('explains when the unresolved gap equals one more repeated row', () => {
    const rows = [
      row(1, 'Other', 1, 39.16),
      row(2, 'Cashews', 1, 1.99),
      row(3, 'Cashews', 1, 1.99),
    ];
    const primary = receipt(45.13, rows);
    const secondary = receipt(45.13, rows);

    const result = reconcileIndependentReceipt(primary, secondary);

    expect(result).toMatchObject({
      status: 'rejected',
      diagnosisCode: 'unresolved_repeated_row_candidate',
      details: {
        repeated_row_candidate: {
          productName: 'Cashews',
          occurrences: 2,
          lineTotal: 1.99,
          gap: 1.99,
        },
      },
    });
    expect(result.publicMessage).toContain('автоматично додавати невидимий рядок небезпечно');
  });

  it('fails closed when independent metadata identifies a different receipt', () => {
    const primary = receipt(1.99, [row(1, 'Cashews', 1, 1.99)]);
    const secondary = validateBulkDocument({
      ...receipt(1.99, [row(1, 'Cashews', 1, 1.99)]),
      date: '2026-08-02',
    });

    expect(reconcileIndependentReceipt(primary, secondary)).toMatchObject({
      status: 'rejected',
      diagnosisCode: 'metadata_disagreement',
    });
  });
});
