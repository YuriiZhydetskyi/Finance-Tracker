/**
 * Unit tests for src/Domain.js.
 *
 * Run via `npm run test`. Uses Node's built-in test runner — no extra deps.
 *
 * What's covered: pure logic (ULID, rounding, parsers, validators, factories,
 * patch helpers). Storage / Fx / Web are exercised by Apps Script smoke tests
 * (src/Smoke.js), not here.
 */

require('./setup');
const test = require('node:test');
const assert = require('node:assert');
const { Domain } = require('../src/Domain.js');

// ============================================================
// ulid()
// ============================================================

test('ulid: 26 Crockford-Base32 characters', () => {
  const id = Domain.ulid();
  assert.strictEqual(id.length, 26);
  assert.match(id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
});

test('ulid: 100 IDs in a tight loop are all unique', () => {
  const ids = new Set();
  for (let i = 0; i < 100; i++) ids.add(Domain.ulid());
  assert.strictEqual(ids.size, 100);
});

test('ulid: time-sortable across a 10ms gap', async () => {
  const before = Domain.ulid();
  await new Promise(r => setTimeout(r, 10));
  const after = Domain.ulid();
  assert.ok(after > before, `expected ${after} > ${before}`);
});

// ============================================================
// roundMoney / roundQty / roundFxRate
// ============================================================

test('roundMoney: classic float drift (0.1 + 0.2 → 0.3)', () => {
  assert.strictEqual(Domain.roundMoney(0.1 + 0.2), 0.3);
});

test('roundMoney: rounds half away from zero at 2dp', () => {
  assert.strictEqual(Domain.roundMoney(3.494), 3.49);
  assert.strictEqual(Domain.roundMoney(3.499), 3.5);
});

test('roundMoney: zero and negatives', () => {
  assert.strictEqual(Domain.roundMoney(0), 0);
  assert.strictEqual(Domain.roundMoney(-1.234), -1.23);
});

test('roundQty: rounds to 3dp', () => {
  assert.strictEqual(Domain.roundQty(1.2345), 1.235);
  assert.strictEqual(Domain.roundQty(0.0001), 0);
});

test('roundFxRate: rounds to 6dp', () => {
  assert.strictEqual(Domain.roundFxRate(0.0245312345), 0.024531);
});

// ============================================================
// parseConsumedBy()
// ============================================================

test('parseConsumedBy: simple types', () => {
  assert.deepStrictEqual(Domain.parseConsumedBy('shared'), { type: 'shared' });
  assert.deepStrictEqual(Domain.parseConsumedBy('his'), { type: 'his' });
  assert.deepStrictEqual(Domain.parseConsumedBy('hers'), { type: 'hers' });
});

test('parseConsumedBy: custom split with valid sums', () => {
  assert.deepStrictEqual(
    Domain.parseConsumedBy('custom:30/70'),
    { type: 'custom', hisShare: 30, hersShare: 70 }
  );
  assert.deepStrictEqual(
    Domain.parseConsumedBy('custom:0/100'),
    { type: 'custom', hisShare: 0, hersShare: 100 }
  );
});

test('parseConsumedBy: rejects custom shares that do not sum to 100', () => {
  assert.throws(() => Domain.parseConsumedBy('custom:30/40'), /sum to 100/);
  assert.throws(() => Domain.parseConsumedBy('custom:60/50'), /sum to 100/);
});

test('parseConsumedBy: rejects malformed input', () => {
  assert.throws(() => Domain.parseConsumedBy('foo'), /Invalid consumed_by/);
  assert.throws(() => Domain.parseConsumedBy('custom:abc/def'), /Invalid consumed_by/);
  assert.throws(() => Domain.parseConsumedBy(''), /Invalid consumed_by/);
});

// ============================================================
// validateReceipt
// ============================================================

function validReceiptObj(overrides = {}) {
  return Object.assign({
    id: '01HM4N6RXX5K2P9F8DZ7QWERTY',
    date: '2026-05-04',
    store: 'Test Store',
    currency: 'EUR',
    total_orig: 5.49,
    fx_rate_eur: 1.0,
    total_eur: 5.49,
    paid_by: 'me@example.com',
    photo_url: null,
    source: 'manual',
    raw_ocr_json: null,
    note: null,
    created_at: '2026-05-04T14:30:00+00:00',
    updated_at: '2026-05-04T14:30:00+00:00',
  }, overrides);
}

test('validateReceipt: accepts a valid receipt', () => {
  assert.doesNotThrow(() => Domain.validateReceipt(validReceiptObj()));
});

test('validateReceipt: rejects bad date format', () => {
  assert.throws(() => Domain.validateReceipt(validReceiptObj({ date: '04.05.2026' })), /date/);
  assert.throws(() => Domain.validateReceipt(validReceiptObj({ date: '2026/05/04' })), /date/);
});

test('validateReceipt: rejects non-ISO 4217 currency', () => {
  assert.throws(() => Domain.validateReceipt(validReceiptObj({ currency: 'eur' })), /currency/);
  assert.throws(() => Domain.validateReceipt(validReceiptObj({ currency: 'EURO' })), /currency/);
});

test('validateReceipt: rejects bad source enum', () => {
  assert.throws(() => Domain.validateReceipt(validReceiptObj({ source: 'foo' })), /source/);
});

test('validateReceipt: rejects email without @', () => {
  assert.throws(() => Domain.validateReceipt(validReceiptObj({ paid_by: 'noemailhere' })), /paid_by/);
});

test('validateReceipt: rejects raw_ocr_json over 45000 chars (cell limit guard)', () => {
  const huge = 'x'.repeat(45001);
  assert.throws(() => Domain.validateReceipt(validReceiptObj({ raw_ocr_json: huge })), /raw_ocr_json/);
});

test('validateReceipt: rejects missing id', () => {
  assert.throws(() => Domain.validateReceipt(validReceiptObj({ id: '' })), /id/);
});

// ============================================================
// validateItem
// ============================================================

function validItemObj(overrides = {}) {
  return Object.assign({
    id: '01HM4N6RZZ7K2P9F8DZ7QWERAA',
    receipt_id: '01HM4N6RXX5K2P9F8DZ7QWERTY',
    product_id: null,
    product_name: 'Bread',
    category: 'Бакалія',
    qty: 1,
    unit_price_orig: 2.49,
    total_orig: 2.49,
    total_eur: 2.49,
    consumed_by: 'shared',
    note: null,
    wasted_qty: 0,
    discount_orig: 0,
    created_at: '2026-05-04T14:30:00+00:00',
    updated_at: '2026-05-04T14:30:00+00:00',
  }, overrides);
}

test('validateItem: accepts a valid item', () => {
  assert.doesNotThrow(() => Domain.validateItem(validItemObj()));
});

test('validateItem: rejects qty <= 0', () => {
  assert.throws(() => Domain.validateItem(validItemObj({ qty: 0 })), /qty/);
  assert.throws(() => Domain.validateItem(validItemObj({ qty: -1 })), /qty/);
});

test('validateItem: rejects wasted_qty > qty', () => {
  assert.throws(
    () => Domain.validateItem(validItemObj({ qty: 1, wasted_qty: 2 })),
    /wasted_qty/
  );
});

test('validateItem: rejects bad consumed_by syntax', () => {
  assert.throws(() => Domain.validateItem(validItemObj({ consumed_by: 'foo' })), /consumed_by/);
});

// ============================================================
// makeReceipt factory
// ============================================================

test('makeReceipt: generates ULID id and matching timestamps', () => {
  const r = Domain.makeReceipt({
    date: '2026-05-04', store: 'Aldi', currency: 'EUR',
    total_orig: 12.34, fx_rate_eur: 1.0,
    paid_by: 'me@example.com', source: 'manual',
  });
  assert.strictEqual(r.id.length, 26);
  assert.ok(r.created_at);
  assert.strictEqual(r.created_at, r.updated_at);
});

test('makeReceipt: rounds total_orig to 2dp on write', () => {
  const r = Domain.makeReceipt({
    date: '2026-05-04', store: 'X', currency: 'EUR',
    total_orig: 12.345, fx_rate_eur: 1.0,
    paid_by: 'me@example.com', source: 'manual',
  });
  assert.strictEqual(r.total_orig, 12.35);
  assert.strictEqual(r.total_eur, 12.35);
});

test('makeReceipt: total_eur = total_orig * fx_rate_eur', () => {
  const r = Domain.makeReceipt({
    date: '2026-05-04', store: 'X', currency: 'UAH',
    total_orig: 1000, fx_rate_eur: 0.0245,
    paid_by: 'me@example.com', source: 'manual',
  });
  assert.strictEqual(r.total_eur, 24.5);
});

test('makeReceipt: defaults nullable fields to null', () => {
  const r = Domain.makeReceipt({
    date: '2026-05-04', store: 'X', currency: 'EUR',
    total_orig: 1, fx_rate_eur: 1.0,
    paid_by: 'me@example.com', source: 'manual',
  });
  assert.strictEqual(r.photo_url, null);
  assert.strictEqual(r.note, null);
  assert.strictEqual(r.raw_ocr_json, null);
});

// ============================================================
// makeItem factory
// ============================================================

test('makeItem: total_orig = qty * unit_price_orig invariant', () => {
  const it = Domain.makeItem({
    receipt_id: '01HM4N6RXX5K2P9F8DZ7QWERTY',
    product_name: 'Test', category: 'Інше',
    qty: 3, unit_price_orig: 1.10,
    fx_rate_eur: 1.0, consumed_by: 'shared',
  });
  assert.strictEqual(it.total_orig, 3.30);
  assert.strictEqual(it.total_eur, 3.30);
});

test('makeItem: defaults wasted_qty=0 and product_id=null', () => {
  const it = Domain.makeItem({
    receipt_id: '01HM4N6RXX5K2P9F8DZ7QWERTY',
    product_name: 'P', category: 'Інше',
    qty: 1, unit_price_orig: 1, fx_rate_eur: 1, consumed_by: 'shared',
  });
  assert.strictEqual(it.wasted_qty, 0);
  assert.strictEqual(it.product_id, null);
});

test('makeItem: rejects wasted_qty > qty at construction', () => {
  assert.throws(() => Domain.makeItem({
    receipt_id: '01HM4N6RXX5K2P9F8DZ7QWERTY',
    product_name: 'P', category: 'Інше',
    qty: 1, unit_price_orig: 1, fx_rate_eur: 1,
    consumed_by: 'shared', wasted_qty: 2,
  }), /wasted_qty/);
});

test('makeItem: accepts negative unit_price_orig (discount, Pfand refund, cancellation)', () => {
  // Negative-price line items are valid by design. qty stays positive;
  // only the price flips sign. total_orig and total_eur propagate the sign.
  const it = Domain.makeItem({
    receipt_id: '01HM4N6RXX5K2P9F8DZ7QWERTY',
    product_name: 'Leergut Einw.allg.', category: 'Pfand',
    qty: 1, unit_price_orig: -8.25,
    fx_rate_eur: 1.0, consumed_by: 'shared',
  });
  assert.strictEqual(it.unit_price_orig, -8.25);
  assert.strictEqual(it.total_orig, -8.25);
  assert.strictEqual(it.total_eur, -8.25);
});

// ============================================================
// discount_orig (ADR-0012)
// ============================================================

test('makeItem: discount_orig defaults to 0 and total_orig matches qty * unit_price_orig', () => {
  const it = Domain.makeItem({
    receipt_id: '01HM4N6RXX5K2P9F8DZ7QWERTY',
    product_name: 'Plain', category: 'Інше',
    qty: 2, unit_price_orig: 1.50,
    fx_rate_eur: 1.0, consumed_by: 'shared',
  });
  assert.strictEqual(it.discount_orig, 0);
  assert.strictEqual(it.total_orig, 3.00);
});

test('makeItem: discount_orig subtracts from per-unit price for total_orig', () => {
  // Mayb.Rose AF 0,75l: 2.99 listed, 1.00 Rabatt → 1.99 effective.
  const it = Domain.makeItem({
    receipt_id: '01HM4N6RXX5K2P9F8DZ7QWERTY',
    product_name: 'Mayb.Rose AF 0,75l', category: 'Алкоголь',
    qty: 1, unit_price_orig: 2.99, discount_orig: 1.00,
    fx_rate_eur: 1.0, consumed_by: 'shared',
  });
  assert.strictEqual(it.unit_price_orig, 2.99);
  assert.strictEqual(it.discount_orig, 1.00);
  assert.strictEqual(it.total_orig, 1.99);
  assert.strictEqual(it.total_eur, 1.99);
});

test('makeItem: discount_orig multiplies with qty in total_orig', () => {
  const it = Domain.makeItem({
    receipt_id: '01HM4N6RXX5K2P9F8DZ7QWERTY',
    product_name: 'X', category: 'Інше',
    qty: 3, unit_price_orig: 5.00, discount_orig: 0.50,
    fx_rate_eur: 1.0, consumed_by: 'shared',
  });
  // 3 * (5.00 - 0.50) = 13.50
  assert.strictEqual(it.total_orig, 13.50);
});

test('validateItem: rejects negative discount_orig', () => {
  assert.throws(
    () => Domain.validateItem(validItemObj({ discount_orig: -0.50 })),
    /discount_orig/
  );
});

test('validateItem: rejects discount_orig that exceeds unit_price_orig', () => {
  assert.throws(
    () => Domain.validateItem(validItemObj({ unit_price_orig: 2.00, discount_orig: 2.50, total_orig: -1.00, total_eur: -1.00 })),
    /discount_orig/
  );
});

test('applyItemPatch: recomputes total_orig when discount_orig changes', () => {
  const it = Domain.makeItem({
    receipt_id: '01HM4N6RXX5K2P9F8DZ7QWERTY',
    product_name: 'X', category: 'Інше',
    qty: 1, unit_price_orig: 5.00,
    fx_rate_eur: 1.0, consumed_by: 'shared',
  });
  assert.strictEqual(it.total_orig, 5.00);
  const updated = Domain.applyItemPatch(it, { discount_orig: 1.50 }, 1.0);
  assert.strictEqual(updated.discount_orig, 1.50);
  assert.strictEqual(updated.total_orig, 3.50);
  assert.strictEqual(updated.total_eur, 3.50);
});

// ============================================================
// applyReceiptPatch
// ============================================================

test('applyReceiptPatch: recomputes total_eur on money-field change', () => {
  const r = Domain.makeReceipt({
    date: '2026-05-04', store: 'X', currency: 'UAH',
    total_orig: 100, fx_rate_eur: 0.025,
    paid_by: 'me@example.com', source: 'manual',
  });
  const updated = Domain.applyReceiptPatch(r, { total_orig: 200 });
  assert.strictEqual(updated.total_orig, 200);
  assert.strictEqual(updated.total_eur, 5);
});

test('applyReceiptPatch: bumps updated_at via mocked clock', (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const r = Domain.makeReceipt({
    date: '2026-05-04', store: 'X', currency: 'EUR',
    total_orig: 1, fx_rate_eur: 1,
    paid_by: 'me@example.com', source: 'manual',
  });
  t.mock.timers.tick(1500);
  const updated = Domain.applyReceiptPatch(r, { note: 'changed' });
  assert.notStrictEqual(updated.updated_at, r.updated_at);
});

test('applyReceiptPatch: preserves id', () => {
  const r = Domain.makeReceipt({
    date: '2026-05-04', store: 'X', currency: 'EUR',
    total_orig: 1, fx_rate_eur: 1,
    paid_by: 'me@example.com', source: 'manual',
  });
  const updated = Domain.applyReceiptPatch(r, { note: 'foo' });
  assert.strictEqual(updated.id, r.id);
});
