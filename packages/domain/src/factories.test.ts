import { describe, it, expect, vi } from 'vitest';
import {
  applyItemPatch,
  applyReceiptPatch,
  makeItem,
  makeProduct,
  makeProductPrice,
  makeReceipt,
  makeStatementTransaction,
} from './factories';

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
    expect(r.store_address).toBe(null);
    expect(r.time).toBe(null);
  });

  it('preserves store_address when provided', () => {
    const r = makeReceipt({
      ...RECEIPT_DEFAULTS,
      total_orig: 1,
      store_address: 'Hauptstr. 12, 80331 München',
    });
    expect(r.store_address).toBe('Hauptstr. 12, 80331 München');
  });

  it('normalizes HH:MM time input to HH:MM:SS', () => {
    const r = makeReceipt({ ...RECEIPT_DEFAULTS, total_orig: 1, time: '14:32' });
    expect(r.time).toBe('14:32:00');
  });

  it('preserves HH:MM:SS time input unchanged', () => {
    const r = makeReceipt({ ...RECEIPT_DEFAULTS, total_orig: 1, time: '14:32:45' });
    expect(r.time).toBe('14:32:45');
  });

  it('coerces empty-string time to null', () => {
    const r = makeReceipt({ ...RECEIPT_DEFAULTS, total_orig: 1, time: '' });
    expect(r.time).toBe(null);
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

  it('defaults store_product_code to null when omitted', () => {
    const it = makeItem({ ...ITEM_DEFAULTS, qty: 1, unit_price_orig: 1 });
    expect(it.store_product_code).toBe(null);
  });

  it('preserves store_product_code when provided', () => {
    const it = makeItem({
      ...ITEM_DEFAULTS,
      qty: 1,
      unit_price_orig: 1,
      store_product_code: '297855',
    });
    expect(it.store_product_code).toBe('297855');
  });

  it('rejects wasted_qty > qty at construction', () => {
    expect(() => makeItem({ ...ITEM_DEFAULTS, qty: 1, unit_price_orig: 1, wasted_qty: 2 })).toThrow(
      /wasted_qty/,
    );
  });

  it('defaults wasted_at to null when wasted_qty is 0', () => {
    const it = makeItem({ ...ITEM_DEFAULTS, qty: 2, unit_price_orig: 1 });
    expect(it.wasted_qty).toBe(0);
    expect(it.wasted_at).toBe(null);
  });

  it('sets wasted_at to now() when wasted_qty > 0 and no wasted_at provided', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-18T12:00:00.000Z'));
    const it = makeItem({ ...ITEM_DEFAULTS, qty: 2, unit_price_orig: 1, wasted_qty: 1 });
    expect(it.wasted_at).toBe('2026-05-18T12:00:00.000Z');
    vi.useRealTimers();
  });

  it('preserves provided wasted_at when wasted_qty > 0', () => {
    const fixed = '2026-04-01T08:00:00.000Z';
    const it = makeItem({
      ...ITEM_DEFAULTS,
      qty: 2,
      unit_price_orig: 1,
      wasted_qty: 1,
      wasted_at: fixed,
    });
    expect(it.wasted_at).toBe(fixed);
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
  it('builds a minimal product with store and null code', () => {
    const p = makeProduct({ name: 'Bread', store: 'Aldi', category: 'Бакалія' });
    expect(p.id).toHaveLength(26);
    expect(p.store).toBe('Aldi');
    expect(p.store_product_code).toBe(null);
    expect(p.unit).toBe(null);
    expect(p.unit_size).toBe(null);
    expect(p.notes).toBe(null);
  });

  it('preserves store_product_code when provided', () => {
    const p = makeProduct({
      name: 'Multivitamin 1l',
      store: 'ALDI SÜD',
      store_product_code: '297855',
      category: 'Напої',
    });
    expect(p.store_product_code).toBe('297855');
  });

  it('rejects empty store (Zod requires non-empty)', () => {
    expect(() => makeProduct({ name: 'X', store: '', category: 'Бакалія' })).toThrow();
  });

  it('accepts unit + unit_size', () => {
    const p = makeProduct({
      name: 'Pesto 190g',
      store: 'Aldi',
      category: 'Бакалія',
      unit: 'g',
      unit_size: 190,
    });
    expect(p.unit).toBe('g');
    expect(p.unit_size).toBe(190);
  });
});

describe('makeProductPrice', () => {
  const PRICE_DEFAULTS = {
    product_id: '01HM4N6RXX5K2P9F8DZ7QWERTY',
    receipt_id: '01HM4N6RXX5K2P9F8DZ7QWXYZ0',
    currency: 'EUR' as const,
    date: '2026-05-04',
  };

  it('rounds price_orig and price_net to 2dp', () => {
    const p = makeProductPrice({
      ...PRICE_DEFAULTS,
      price_orig: 1.999,
      price_net: 1.789,
    });
    expect(p.price_orig).toBe(2.0);
    expect(p.price_net).toBe(1.79);
  });

  it('generates a 26-char ULID id', () => {
    const p = makeProductPrice({ ...PRICE_DEFAULTS, price_orig: 1, price_net: 1 });
    expect(p.id).toHaveLength(26);
  });

  it('preserves negative prices (Pfand refund snapshot)', () => {
    const p = makeProductPrice({
      ...PRICE_DEFAULTS,
      price_orig: -0.25,
      price_net: -0.25,
    });
    expect(p.price_orig).toBe(-0.25);
    expect(p.price_net).toBe(-0.25);
  });
});

describe('makeStatementTransaction', () => {
  const TXN_DEFAULTS = {
    date: '2026-05-25',
    amount_orig: 12.34,
    currency: 'EUR' as const,
    paid_by: 'me@example.com',
  };

  it('generates a ULID, defaults status=unmatched, receipt_id=null', () => {
    const t = makeStatementTransaction(TXN_DEFAULTS);
    expect(t.id).toHaveLength(26);
    expect(t.status).toBe('unmatched');
    expect(t.receipt_id).toBe(null);
    expect(t.created_at).toBe(t.updated_at);
  });

  it('rounds amount to 2dp and normalizes HH:MM time', () => {
    const t = makeStatementTransaction({ ...TXN_DEFAULTS, amount_orig: 12.345, time: '14:32' });
    expect(t.amount_orig).toBe(12.35);
    expect(t.time).toBe('14:32:00');
  });

  it('defaults merchant/raw/time/suggested_category to null', () => {
    const t = makeStatementTransaction(TXN_DEFAULTS);
    expect(t.merchant).toBe(null);
    expect(t.raw).toBe(null);
    expect(t.time).toBe(null);
    expect(t.suggested_category).toBe(null);
  });

  it('keeps the AI-suggested category when provided', () => {
    const t = makeStatementTransaction({ ...TXN_DEFAULTS, suggested_category: 'Кафе/ресторани' });
    expect(t.suggested_category).toBe('Кафе/ресторани');
  });

  it('builds a stable dedup_key from date|amount|currency|label|occurrence', () => {
    const t = makeStatementTransaction({ ...TXN_DEFAULTS, merchant: 'Lidl' });
    expect(t.dedup_key).toBe('2026-05-25|12.34|EUR|lidl|0');
  });

  it('uses the same dedup_key for the same logical transaction (re-import safe)', () => {
    const a = makeStatementTransaction({ ...TXN_DEFAULTS, merchant: 'LIDL' });
    const b = makeStatementTransaction({ ...TXN_DEFAULTS, merchant: 'lidl' });
    expect(a.dedup_key).toBe(b.dedup_key);
  });

  it('distinguishes genuine same-import duplicates by occurrence', () => {
    const first = makeStatementTransaction({ ...TXN_DEFAULTS, merchant: 'Lidl', occurrence: 0 });
    const second = makeStatementTransaction({ ...TXN_DEFAULTS, merchant: 'Lidl', occurrence: 1 });
    expect(first.dedup_key).not.toBe(second.dedup_key);
    expect(second.dedup_key).toBe('2026-05-25|12.34|EUR|lidl|1');
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

  it('normalizes HH:MM time in patch to HH:MM:SS', () => {
    const r = makeReceipt({ ...RECEIPT_DEFAULTS, total_orig: 1 });
    const updated = applyReceiptPatch(r, { time: '09:15' });
    expect(updated.time).toBe('09:15:00');
  });

  it('clears time when patch sets it to null', () => {
    const r = makeReceipt({ ...RECEIPT_DEFAULTS, total_orig: 1, time: '14:00' });
    expect(r.time).toBe('14:00:00');
    const updated = applyReceiptPatch(r, { time: null });
    expect(updated.time).toBe(null);
  });

  it('updates store_address through a patch', () => {
    const r = makeReceipt({ ...RECEIPT_DEFAULTS, total_orig: 1 });
    const updated = applyReceiptPatch(r, { store_address: 'Bahnhofstr. 5' });
    expect(updated.store_address).toBe('Bahnhofstr. 5');
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

// ── Edge cases ──────────────────────────────────────────────────────────────

describe('makeReceipt — fx_rate_eur boundary', () => {
  it('rejects fx_rate_eur = 0 (Zod requires positive)', () => {
    expect(() => makeReceipt({ ...RECEIPT_DEFAULTS, fx_rate_eur: 0, total_orig: 10 })).toThrow();
  });

  it('rejects negative fx_rate_eur (Zod requires positive)', () => {
    expect(() =>
      makeReceipt({ ...RECEIPT_DEFAULTS, fx_rate_eur: -0.025, total_orig: 10 }),
    ).toThrow();
  });
});

describe('makeItem — discount/unit_price interaction', () => {
  it('rejects discount_orig > positive unit_price_orig (would flip sign)', () => {
    expect(() =>
      makeItem({
        ...ITEM_DEFAULTS,
        qty: 1,
        unit_price_orig: 2.0,
        discount_orig: 5.0,
      }),
    ).toThrow(/discount_orig/);
  });

  it('allows any discount when unit_price_orig is negative (Pfand-style edge)', () => {
    // Schema only checks discount > price when price > 0; negative-price items skip the check.
    const it = makeItem({
      ...ITEM_DEFAULTS,
      qty: 1,
      unit_price_orig: -2.0,
      discount_orig: 1.0,
    });
    expect(it.unit_price_orig).toBe(-2.0);
    expect(it.discount_orig).toBe(1.0);
    // total_orig = 1 * (-2.0 - 1.0) = -3.0
    expect(it.total_orig).toBe(-3.0);
  });

  it('rejects negative discount_orig (Zod nonnegative)', () => {
    expect(() =>
      makeItem({
        ...ITEM_DEFAULTS,
        qty: 1,
        unit_price_orig: 5.0,
        discount_orig: -1.0,
      }),
    ).toThrow();
  });
});

describe('applyReceiptPatch — idempotency & invariants', () => {
  it('two patches with the same diff produce equivalent money fields', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-04T10:00:00Z'));
    const r = makeReceipt({
      ...RECEIPT_DEFAULTS,
      currency: 'UAH',
      total_orig: 100,
      fx_rate_eur: 0.025,
    });
    vi.advanceTimersByTime(1000);
    const once = applyReceiptPatch(r, { total_orig: 200 });
    vi.advanceTimersByTime(1000);
    const twice = applyReceiptPatch(once, { total_orig: 200 });
    expect(twice.total_orig).toBe(once.total_orig);
    expect(twice.total_eur).toBe(once.total_eur);
    expect(twice.id).toBe(r.id);
    // updated_at still bumps even when the value didn't change.
    expect(twice.updated_at).not.toBe(once.updated_at);
    vi.useRealTimers();
  });

  it('rejects fx_rate_eur = 0 in a patch', () => {
    const r = makeReceipt({ ...RECEIPT_DEFAULTS, total_orig: 10 });
    expect(() => applyReceiptPatch(r, { fx_rate_eur: 0 })).toThrow();
  });
});
