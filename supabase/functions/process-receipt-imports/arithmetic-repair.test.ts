import { describe, expect, it, vi } from 'vitest';
import type { AiContext, BulkParsedDocument } from '../parse-receipt/types.ts';
import { repairArithmeticMismatch } from './arithmetic-repair.ts';
import { validateBulkDocument } from './domain.ts';

const ctx: AiContext = { categories: ['Інше'], products: [], mimeType: 'application/pdf' };

function receipt(unitPrice: number, total = 1.49): BulkParsedDocument {
  return validateBulkDocument({
    document_kind: 'receipt',
    classification_reason: 'Cash receipt',
    store: 'ALDI',
    store_address: 'Example 1',
    date: '2026-08-01',
    time: '11:45',
    currency: 'EUR',
    total_orig: total,
    items: [{ product_name: 'Landliebe', qty: 1, unit_price_orig: unitPrice }],
  });
}

describe('bulk arithmetic repair', () => {
  it('accepts an independently re-read item list only when it reaches the fixed printed total', async () => {
    const parsed = receipt(1);
    const repairBulkItems = vi.fn().mockResolvedValue({
      items: [{ product_name: 'Landliebe', qty: 1, unit_price_orig: 1.49 }],
    });

    const result = await repairArithmeticMismatch(parsed, 'PDF', ctx, { repairBulkItems });

    expect(result.status).toBe('accepted');
    expect(result.after).toMatchObject({ computedTotal: 1.49, printedTotal: 1.49, matches: true });
    expect(result.parsed).toMatchObject({
      store: parsed.store,
      store_address: parsed.store_address,
      date: parsed.date,
      time: parsed.time,
      currency: parsed.currency,
      total_orig: parsed.total_orig,
    });
    expect(result.parsed.items[0]?.unit_price_orig).toBe(1.49);
    expect(repairBulkItems).toHaveBeenCalledWith(
      'PDF',
      ctx,
      expect.objectContaining({ expectedTotalOrig: 1.49, previousComputedTotal: 1 }),
    );
  });

  it('rejects a repair that still does not match and preserves the original parse', async () => {
    const parsed = receipt(1);
    const result = await repairArithmeticMismatch(parsed, 'PDF', ctx, {
      repairBulkItems: vi.fn().mockResolvedValue({
        items: [{ product_name: 'Landliebe', qty: 1, unit_price_orig: 1.2 }],
      }),
    });

    expect(result.status).toBe('rejected');
    expect(result.parsed).toBe(parsed);
    expect(result.after).toMatchObject({ computedTotal: 1.2, matches: false });
  });

  it('does not call a provider when deterministic arithmetic already matches', async () => {
    const repairBulkItems = vi.fn();
    const result = await repairArithmeticMismatch(receipt(1.49), 'PDF', ctx, {
      repairBulkItems,
    });

    expect(result.status).toBe('not_needed');
    expect(repairBulkItems).not.toHaveBeenCalled();
  });

  it('keeps the mismatch for review when no independent provider is available', async () => {
    const parsed = receipt(1);
    const result = await repairArithmeticMismatch(parsed, 'PDF', ctx, null);

    expect(result.status).toBe('unavailable');
    expect(result.parsed).toBe(parsed);
  });

  it('fails closed when the repair response has malformed items', async () => {
    const parsed = receipt(1);
    const result = await repairArithmeticMismatch(parsed, 'PDF', ctx, {
      repairBulkItems: vi.fn().mockResolvedValue({ items: [{ malformed: true }] }),
    });

    expect(result.status).toBe('failed');
    expect(result.parsed).toBe(parsed);
  });
});
