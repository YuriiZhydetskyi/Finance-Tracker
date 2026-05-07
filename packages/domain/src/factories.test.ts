import { describe, it, expect, vi } from 'vitest';
import { applyItemPatch, applyReceiptPatch, makeItem, makeProduct, makeReceipt } from './factories';

const RECEIPT_DEFAULTS = {
  date: '2026-05-04',
  store: 'Aldi',
  currency: 'EUR',
  fx_rate_eur: 1.0,
  paid_by: 'me@example.com',
  source: 'manual' as const,
};

const ITEM_DEFAULTS = {
  receipt_id: '01HM4N6RXX5K2P9F8DZ7QWERTY',
  product_name: 'Test',
  category: 'Інше',
  fx_rate_eur: 1.0,
  consumed_by: 'shared',
};

describe('makeReceipt', () => {
  it('generates a 26-char ULID id and matching timestamps', () => {
    const r = makeReceipt({ ...RECEIPT_DEFAULTS, total_orig: 12.34 });
    expect(r.id).toHaveLength(26);
    expect(r.created_at).toBe(r.updated_at);
  });

  it('rounds total_orig to 2dp on write', () => {
    const r = makeReceipt({ ...RECEIPT_DEFAULTS, store: 'X', total_orig: 12.345 });
    expect(r.total_orig).toBe(12.35);
    expect(r.total_eur).toBe(12.35);
  });

  it('computes total_eur = total_orig × fx_rate_eur', () => {
    const r = makeReceipt({
      ...RECEIPT_DEFAULTS,
      currency: 'UAH',
      total_orig: 1000,
      fx_rate_eur: 0.0245,
    });
    expect(r.total_eur).toBe(24.5);
  });

  it('defaults nullable fields to null', () => {
    const r = makeReceipt({ ...RECEIPT_DEFAULTS, total_orig: 1 });
    expect(r.photo_url).toBe(null);
    expect(r.note).toBe(null);
    expect(r.raw_ocr_json).toBe(null);
  });
});

describe('makeItem', () => {
  it('enforces total_orig = qty × unit_price_orig invariant', () => {
    const it = makeItem({ ...ITEM_DEFAULTS, qty: 3, unit_price_orig: 1.1 });
    expect(it.total_orig).toBe(3.3);
    expect(it.total_eur).toBe(3.3);
  });

  it('defaults wasted_qty=0 and product_id=null', () => {
    const it = makeItem({ ...ITEM_DEFAULTS, qty: 1, unit_price_orig: 1 });
    expect(it.wasted_qty).toBe(0);
    expect(it.product_id).toBe(null);
  });

  it('rejects wasted_qty > qty at construction', () => {
    expect(() => makeItem({ ...ITEM_DEFAULTS, qty: 1, unit_price_orig: 1, wasted_qty: 2 })).toThrow(
      /wasted_qty/,
    );
  });

  it('accepts negative unit_price_orig (Pfand refund / discount / cancellation)', () => {
    const it = makeItem({
      ...ITEM_DEFAULTS,
      product_name: 'Leergut Einw.allg.',
      category: 'Pfand',
      qty: 1,
      unit_price_orig: -8.25,
    });
    expect(it.unit_price_orig).toBe(-8.25);
    expect(it.total_orig).toBe(-8.25);
    expect(it.total_eur).toBe(-8.25);
  });
});

describe('makeItem — discount_orig (ADR-0012)', () => {
  it('defaults to 0 and total_orig matches qty × unit_price_orig', () => {
    const it = makeItem({
      ...ITEM_DEFAULTS,
      product_name: 'Plain',
      qty: 2,
      unit_price_orig: 1.5,
    });
    expect(it.discount_orig).toBe(0);
    expect(it.total_orig).toBe(3.0);
  });

  it('subtracts from per-unit price for total_orig', () => {
    // Mayb.Rose AF 0,75l: 2.99 listed, 1.00 Rabatt → 1.99 effective.
    const it = makeItem({
      ...ITEM_DEFAULTS,
      product_name: 'Mayb.Rose AF 0,75l',
      category: 'Алкоголь',
      qty: 1,
      unit_price_orig: 2.99,
      discount_orig: 1.0,
    });
    expect(it.unit_price_orig).toBe(2.99);
    expect(it.discount_orig).toBe(1.0);
    expect(it.total_orig).toBe(1.99);
    expect(it.total_eur).toBe(1.99);
  });

  it('multiplies with qty in total_orig', () => {
    const it = makeItem({
      ...ITEM_DEFAULTS,
      product_name: 'X',
      qty: 3,
      unit_price_orig: 5.0,
      discount_orig: 0.5,
    });
    // 3 * (5.00 - 0.50) = 13.50
    expect(it.total_orig).toBe(13.5);
  });
});

describe('makeProduct', () => {
  it('builds a minimal product', () => {
    const p = makeProduct({ name: 'Bread', category: 'Бакалія' });
    expect(p.id).toHaveLength(26);
    expect(p.unit).toBe(null);
    expect(p.unit_size).toBe(null);
    expect(p.notes).toBe(null);
  });

  it('accepts unit + unit_size', () => {
    const p = makeProduct({
      name: 'Pesto 190g',
      category: 'Бакалія',
      unit: 'g',
      unit_size: 190,
    });
    expect(p.unit).toBe('g');
    expect(p.unit_size).toBe(190);
  });
});

describe('applyReceiptPatch', () => {
  it('recomputes total_eur on money-field change', () => {
    const r = makeReceipt({
      ...RECEIPT_DEFAULTS,
      currency: 'UAH',
      total_orig: 100,
      fx_rate_eur: 0.025,
    });
    const updated = applyReceiptPatch(r, { total_orig: 200 });
    expect(updated.total_orig).toBe(200);
    expect(updated.total_eur).toBe(5);
  });

  it('bumps updated_at via mocked clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-04T14:30:00Z'));
    const r = makeReceipt({ ...RECEIPT_DEFAULTS, total_orig: 1 });
    vi.advanceTimersByTime(1500);
    const updated = applyReceiptPatch(r, { note: 'changed' });
    expect(updated.updated_at).not.toBe(r.updated_at);
    vi.useRealTimers();
  });

  it('preserves id', () => {
    const r = makeReceipt({ ...RECEIPT_DEFAULTS, total_orig: 1 });
    const updated = applyReceiptPatch(r, { note: 'foo' });
    expect(updated.id).toBe(r.id);
  });
});

describe('applyItemPatch', () => {
  it('recomputes total_orig when discount_orig changes', () => {
    const it = makeItem({ ...ITEM_DEFAULTS, qty: 1, unit_price_orig: 5.0 });
    expect(it.total_orig).toBe(5.0);
    const updated = applyItemPatch(it, { discount_orig: 1.5 }, 1.0);
    expect(updated.discount_orig).toBe(1.5);
    expect(updated.total_orig).toBe(3.5);
    expect(updated.total_eur).toBe(3.5);
  });
});
