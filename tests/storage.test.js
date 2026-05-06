/**
 * Integration tests for src/Storage.js using in-memory Apps Script fakes.
 *
 * Covers:
 *   - Receipt CRUD round-trip (insert → get → delete)
 *   - Items batch insert + getByReceipt + cascade delete via deleteReceipt
 *   - Products CRUD + findProductByName
 *   - Categories read
 *   - listRecent ordering (date desc, then created_at desc)
 *   - LockService is invoked for multi-row writes
 */

const test = require('node:test');
const assert = require('node:assert');

const { fakes, resetAllFakes, Domain, Storage } = require('./bootstrap');

const SHEETS = ['Receipts', 'Items', 'Products', 'Categories'];
const HEADERS = {
  Receipts: ['id', 'date', 'store', 'currency', 'total_orig', 'fx_rate_eur', 'total_eur', 'paid_by', 'photo_url', 'source', 'raw_ocr_json', 'note', 'created_at', 'updated_at'],
  Items: ['id', 'receipt_id', 'product_id', 'product_name', 'category', 'qty', 'unit_price_orig', 'total_orig', 'total_eur', 'consumed_by', 'note', 'wasted_qty', 'discount_orig', 'created_at', 'updated_at'],
  Products: ['id', 'name', 'category', 'unit', 'unit_size', 'notes', 'created_at', 'updated_at'],
  Categories: ['name', 'group'],
};

function setupSheet() {
  resetAllFakes();
  Storage.resetCaches();
  const ss = fakes.SpreadsheetApp.openById('fake-sheet-id');
  for (const name of SHEETS) {
    ss.createSheetWithHeaders(name, HEADERS[name]);
  }
  return ss;
}

// Helpers to build valid entities ----------------------------------------

function makeTestReceipt(overrides = {}) {
  return Domain.makeReceipt(Object.assign({
    date: '2026-05-04',
    store: 'Test Store',
    currency: 'EUR',
    total_orig: 5.49,
    fx_rate_eur: 1.0,
    paid_by: 'me@example.com',
    source: 'manual',
  }, overrides));
}

function makeTestItem(receipt_id, overrides = {}) {
  return Domain.makeItem(Object.assign({
    receipt_id,
    product_name: 'Test Product',
    category: 'Інше',
    qty: 1,
    unit_price_orig: 1.99,
    fx_rate_eur: 1.0,
    consumed_by: 'shared',
  }, overrides));
}

// ============================================================
// Receipts CRUD
// ============================================================

test('Storage.appendReceipt + getReceipt: round-trip', () => {
  setupSheet();
  const r = makeTestReceipt();
  Storage.appendReceipt(r);
  const got = Storage.getReceipt(r.id);
  assert.ok(got);
  assert.strictEqual(got.id, r.id);
  assert.strictEqual(got.store, 'Test Store');
  assert.strictEqual(got.total_orig, 5.49);
});

test('Storage.getReceipt: returns null for unknown id', () => {
  setupSheet();
  assert.strictEqual(Storage.getReceipt('nonexistent-id'), null);
});

test('Storage.updateReceipt: writes new values', () => {
  setupSheet();
  const r = makeTestReceipt();
  Storage.appendReceipt(r);
  const patched = Domain.applyReceiptPatch(r, { note: 'updated' });
  Storage.updateReceipt(patched);
  const got = Storage.getReceipt(r.id);
  assert.strictEqual(got.note, 'updated');
});

test('Storage.updateReceipt: throws when id not found', () => {
  setupSheet();
  const r = makeTestReceipt();
  assert.throws(() => Storage.updateReceipt(r), /not found/);
});

test('Storage.deleteReceipt: removes receipt and cascades to items', () => {
  setupSheet();
  const r = makeTestReceipt();
  Storage.appendReceipt(r);
  Storage.appendItems([makeTestItem(r.id), makeTestItem(r.id)]);

  assert.strictEqual(Storage.getItemsByReceipt(r.id).length, 2);

  Storage.deleteReceipt(r.id);

  assert.strictEqual(Storage.getReceipt(r.id), null);
  assert.strictEqual(Storage.getItemsByReceipt(r.id).length, 0);
});

test('Storage.deleteReceipt: throws when id not found', () => {
  setupSheet();
  assert.throws(() => Storage.deleteReceipt('missing'), /not found/);
});

// ============================================================
// Items
// ============================================================

test('Storage.appendItems: enforces same receipt_id', () => {
  setupSheet();
  const r1 = makeTestReceipt();
  const r2 = makeTestReceipt({ store: 'X' });
  Storage.appendReceipt(r1);
  Storage.appendReceipt(r2);
  assert.throws(() => Storage.appendItems([makeTestItem(r1.id), makeTestItem(r2.id)]),
    /same receipt_id/);
});

test('Storage.getItemsByReceipt: filters correctly', () => {
  setupSheet();
  const r1 = makeTestReceipt();
  const r2 = makeTestReceipt({ store: 'Y' });
  Storage.appendReceipt(r1);
  Storage.appendReceipt(r2);
  Storage.appendItems([makeTestItem(r1.id, { product_name: 'A' })]);
  Storage.appendItems([makeTestItem(r2.id, { product_name: 'B' })]);

  const items1 = Storage.getItemsByReceipt(r1.id);
  assert.strictEqual(items1.length, 1);
  assert.strictEqual(items1[0].product_name, 'A');
});

test('Storage.updateItem: persists changes', () => {
  setupSheet();
  const r = makeTestReceipt();
  Storage.appendReceipt(r);
  const it = makeTestItem(r.id);
  Storage.appendItems([it]);
  const patched = Domain.applyItemPatch(it, { note: 'changed' }, 1.0);
  Storage.updateItem(patched);
  const got = Storage.getItemsByReceipt(r.id)[0];
  assert.strictEqual(got.note, 'changed');
});

test('Storage.deleteItem: removes single item', () => {
  setupSheet();
  const r = makeTestReceipt();
  Storage.appendReceipt(r);
  const it1 = makeTestItem(r.id, { product_name: 'A' });
  const it2 = makeTestItem(r.id, { product_name: 'B' });
  Storage.appendItems([it1, it2]);

  Storage.deleteItem(it1.id);

  const remaining = Storage.getItemsByReceipt(r.id);
  assert.strictEqual(remaining.length, 1);
  assert.strictEqual(remaining[0].product_name, 'B');
});

test('Storage.appendItems + getItemsByReceipt: discount_orig round-trips', () => {
  setupSheet();
  const r = makeTestReceipt();
  Storage.appendReceipt(r);
  const it = makeTestItem(r.id, {
    product_name: 'Mayb.Rose AF 0,75l',
    unit_price_orig: 2.99,
    discount_orig: 1.00,
  });
  Storage.appendItems([it]);
  const got = Storage.getItemsByReceipt(r.id)[0];
  assert.strictEqual(got.unit_price_orig, 2.99);
  assert.strictEqual(got.discount_orig, 1.00);
  assert.strictEqual(got.total_orig, 1.99);
  assert.strictEqual(got.total_eur, 1.99);
});

// ============================================================
// Products
// ============================================================

test('Storage.appendProduct + getProduct: round-trip', () => {
  setupSheet();
  const p = Domain.makeProduct({ name: 'Pesto Barilla 190g', category: 'Бакалія' });
  Storage.appendProduct(p);
  const got = Storage.getProduct(p.id);
  assert.ok(got);
  assert.strictEqual(got.name, 'Pesto Barilla 190g');
});

test('Storage.findProductByName: exact match', () => {
  setupSheet();
  Storage.appendProduct(Domain.makeProduct({ name: 'Coca Cola 500ml', category: 'Бакалія' }));
  Storage.appendProduct(Domain.makeProduct({ name: 'Pepsi 500ml', category: 'Бакалія' }));

  const coke = Storage.findProductByName('Coca Cola 500ml');
  assert.ok(coke);
  assert.strictEqual(coke.name, 'Coca Cola 500ml');

  assert.strictEqual(Storage.findProductByName('Sprite 500ml'), null);
});

// ============================================================
// Categories
// ============================================================

test('Storage.getCategories: returns seeded categories', () => {
  const ss = setupSheet();
  const sheet = ss.getSheetByName('Categories');
  sheet.appendRow(['Молочка', 'Продукти']);
  sheet.appendRow(['Алкоголь', 'Продукти']);
  sheet.appendRow(['Інше', 'Інше']);

  const cats = Storage.getCategories();
  assert.strictEqual(cats.length, 3);
  // Cyrillic sort by code point: І (U+0406) < А (U+0410) < М (U+041C)
  assert.deepStrictEqual(cats.map(c => c.name).sort(), ['Інше', 'Алкоголь', 'Молочка']);
});

// ============================================================
// listRecent ordering
// ============================================================

test('Storage.listRecent: orders by date desc then created_at desc', async () => {
  setupSheet();
  const old = makeTestReceipt({ date: '2026-04-01' });
  Storage.appendReceipt(old);
  await new Promise(r => setTimeout(r, 5));
  const newer = makeTestReceipt({ date: '2026-05-01' });
  Storage.appendReceipt(newer);
  await new Promise(r => setTimeout(r, 5));
  const newest = makeTestReceipt({ date: '2026-05-01' });
  Storage.appendReceipt(newest);

  const recent = Storage.listRecent(10);
  assert.strictEqual(recent.length, 3);
  assert.strictEqual(recent[0].id, newest.id);
  assert.strictEqual(recent[1].id, newer.id);
  assert.strictEqual(recent[2].id, old.id);
});

test('Storage.listRecent: respects limit', () => {
  setupSheet();
  for (let i = 0; i < 5; i++) {
    Storage.appendReceipt(makeTestReceipt({ store: `S${i}` }));
  }
  assert.strictEqual(Storage.listRecent(3).length, 3);
});

// ============================================================
// LockService invocation
// ============================================================

test('Storage._withLock invokes LockService.getScriptLock for writes', () => {
  setupSheet();
  const before = fakes.LockService._stats();
  Storage.appendReceipt(makeTestReceipt());
  const after = fakes.LockService._stats();
  assert.ok(after.lockCount > before.lockCount, 'lock should be acquired');
  assert.strictEqual(after.lockCount, after.releaseCount, 'every lock must be released');
});
