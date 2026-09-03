import { describe, expect, it } from 'vitest';
import { ParsedReceiptSchema } from '@finance-tracker/domain';
import { validateManualJsonReceipt } from './validate-manual-json';

function parseReceipt(candidate: unknown) {
  return ParsedReceiptSchema.parse(candidate);
}

describe('validateManualJsonReceipt', () => {
  it('accepts a balanced receipt without optional OCR evidence', () => {
    const candidate = {
      store: 'Lidl',
      date: '2026-05-25',
      currency: 'EUR',
      total_orig: 3.01,
      items: [
        { product_name: 'Bread', qty: 2, unit_price_orig: 1.5, category_suggestion: null },
        { product_name: 'Bag', qty: 1, unit_price_orig: 0.01, category_suggestion: null },
      ],
    };

    expect(validateManualJsonReceipt(candidate, parseReceipt(candidate))).toEqual([]);
  });

  it('reports a sum mismatch before the receipt enters review', () => {
    const candidate = {
      store: 'Lidl',
      date: '2026-05-25',
      currency: 'EUR',
      total_orig: 3,
      items: [{ product_name: 'Bread', qty: 1, unit_price_orig: 1.5, category_suggestion: null }],
    };

    expect(validateManualJsonReceipt(candidate, parseReceipt(candidate))).toEqual([
      'Сума позицій 1,50 EUR не збігається з total_orig 3,00 EUR (різниця 1,50 EUR).',
    ]);
  });

  it('checks article_count using supplied row kinds', () => {
    const candidate = {
      store: 'Marktkauf',
      date: '2026-08-14',
      currency: 'EUR',
      total_orig: 1,
      article_count: 2,
      items: [
        {
          product_name: 'Bread',
          qty: 1,
          unit_price_orig: 1,
          category_suggestion: null,
          row_kind: 'item',
        },
        {
          product_name: 'Coupon',
          qty: 1,
          unit_price_orig: 0,
          category_suggestion: null,
          row_kind: 'discount',
        },
      ],
    };

    expect(validateManualJsonReceipt(candidate, parseReceipt(candidate))).toContain(
      'article_count вказує 2 товарів, але в JSON розпізнано 1.',
    );
  });

  it('checks supplied printed line totals and source order', () => {
    const candidate = {
      store: 'Lidl',
      date: '2026-05-25',
      currency: 'EUR',
      total_orig: 3,
      items: [
        {
          product_name: 'Bread',
          qty: 1,
          unit_price_orig: 3,
          category_suggestion: null,
          printed_line_total_orig: 2,
          source_ordinal: 2,
        },
      ],
    };

    expect(validateManualJsonReceipt(candidate, parseReceipt(candidate))).toEqual([
      'Рядок 1: сума 3,00 EUR не збігається з printed_line_total_orig 2,00 EUR.',
      'Пропущено source_ordinal 1.',
    ]);
  });

  it('requires audit evidence when JSON will resolve a durable import file', () => {
    const candidate = {
      store: 'Lidl',
      date: '2026-05-25',
      currency: 'EUR',
      total_orig: 1.49,
      items: [
        {
          product_name: 'Bread',
          qty: 1,
          unit_price_orig: 1.49,
          category_suggestion: null,
        },
      ],
    };

    const issues = validateManualJsonReceipt(candidate, parseReceipt(candidate), {
      requireEvidence: true,
      requireSavableReceipt: true,
    });

    expect(issues).toContain('Додай total_raw_text — дослівний рядок чека з фінальним підсумком.');
    expect(issues).toContain('Рядок 1: додай raw_text із дослівним текстом позиції.');
    expect(issues).toContain('Рядок 1: додай числовий printed_line_total_orig.');
    expect(issues).toContain('Додай source_ordinal у кожний рядок.');
  });

  it('compares a correction with the total and article count from the original analysis', () => {
    const candidate = {
      store: 'Lidl',
      date: '2026-05-25',
      currency: 'EUR',
      total_orig: 3.05,
      total_raw_text: 'SUMME EUR 3,05',
      article_count: 1,
      article_count_raw_text: '1 Artikel',
      items: [
        {
          product_name: 'Bread',
          qty: 1,
          unit_price_orig: 3.05,
          category_suggestion: null,
          row_kind: 'item',
          qty_evidence: 'implicit_one',
          source_ordinal: 1,
          raw_text: 'Bread 3,05',
          printed_line_total_orig: 3.05,
        },
      ],
    };

    const issues = validateManualJsonReceipt(candidate, parseReceipt(candidate), {
      requireEvidence: true,
      expectedTotalOrig: 3,
      expectedArticleCount: 2,
    });

    expect(issues.some((issue) => issue.includes('раніше прочитаним підсумком 3,00'))).toBe(true);
    expect(issues.some((issue) => issue.includes('попередній аналіз прочитав 2'))).toBe(true);
  });

  it('accepts refund and cancellation row kinds with signed evidence', () => {
    const candidate = {
      store: 'Lidl',
      date: '2026-05-25',
      currency: 'EUR',
      total_orig: 1,
      total_raw_text: 'SUMME EUR 1,00',
      article_count: 1,
      article_count_raw_text: '1 Artikel',
      items: [
        {
          product_name: 'Bread',
          qty: 1,
          unit_price_orig: 2,
          row_kind: 'item',
          qty_evidence: 'implicit_one',
          source_ordinal: 1,
          raw_text: 'Bread 2,00',
          printed_line_total_orig: 2,
        },
        {
          product_name: 'Leergut',
          qty: 1,
          unit_price_orig: -0.5,
          row_kind: 'refund',
          qty_evidence: 'implicit_one',
          source_ordinal: 2,
          raw_text: 'Leergut -0,50',
          printed_line_total_orig: -0.5,
        },
        {
          product_name: 'Storno',
          qty: 1,
          unit_price_orig: -0.5,
          row_kind: 'cancellation',
          qty_evidence: 'implicit_one',
          source_ordinal: 3,
          raw_text: 'Storno -0,50',
          printed_line_total_orig: -0.5,
        },
      ],
    };

    expect(
      validateManualJsonReceipt(candidate, parseReceipt(candidate), {
        requireEvidence: true,
        requireSavableReceipt: true,
      }),
    ).toEqual([]);
  });
});
