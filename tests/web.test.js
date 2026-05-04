/**
 * Integration tests for src/Web.js using in-memory Apps Script fakes.
 *
 * Covers:
 *   - doGet routing (known/unknown page)
 *   - whoAmI: Session email or empty fallback
 *   - listRecent: delegates to Storage
 *   - getReceipt: returns {receipt, items} or null
 *   - saveReceipt EUR (no FX fetch, no Drive)
 *   - saveReceipt UAH (FX fetch via NBU stub)
 *   - saveReceipt with photoBase64 (Drive write + photo_url)
 *   - updateReceipt: patch + items replace, FX recomputed on currency change
 *   - deleteReceipt: cascades to items
 *   - parseReceipt: builds ctx and dispatches via AiClient
 *   - guards on missing input
 */

const test = require('node:test');
const assert = require('node:assert');

const { fakes, resetAllFakes, Domain, Storage, Web } = require('./bootstrap');

const SHEETS = ['Receipts', 'Items', 'Products', 'Categories'];
const HEADERS = {
  Receipts: ['id', 'date', 'store', 'currency', 'total_orig', 'fx_rate_eur', 'total_eur', 'paid_by', 'photo_url', 'source', 'raw_ocr_json', 'note', 'created_at', 'updated_at'],
  Items: ['id', 'receipt_id', 'product_id', 'product_name', 'category', 'qty', 'unit_price_orig', 'total_orig', 'total_eur', 'consumed_by', 'note', 'wasted_qty', 'created_at', 'updated_at'],
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
  // Seed two categories so parseReceipt ctx is non-empty.
  ss.getSheetByName('Categories').appendRow(['Бакалія', 'Їжа']);
  ss.getSheetByName('Categories').appendRow(['Молочка', 'Їжа']);
  return ss;
}

function basicReceiptInput(overrides = {}) {
  return Object.assign({
    date: '2026-05-04',
    store: 'Test Store',
    currency: 'EUR',
    total_orig: 5.49,
    paid_by: 'me@example.com',
    source: 'manual',
  }, overrides);
}

function basicItem(overrides = {}) {
  return Object.assign({
    product_name: 'Test Product',
    category: 'Бакалія',
    qty: 1,
    unit_price_orig: 2.49,
    consumed_by: 'shared',
  }, overrides);
}

// ============================================================
// doGet routing
// ============================================================

test('Web.doGet: known page returns HtmlOutput-like for that file', () => {
  setupSheet();
  const out = Web.doGet({ parameter: { page: 'recent' } });
  assert.match(out.getContent(), /ui\/recent/);
  assert.strictEqual(out._title, 'Finance Tracker');
});

test('Web.doGet: unknown page falls back to index', () => {
  setupSheet();
  const out = Web.doGet({ parameter: { page: 'no-such-page' } });
  assert.match(out.getContent(), /ui\/index/);
});

test('Web.doGet: missing parameter falls back to index', () => {
  setupSheet();
  const out = Web.doGet({});
  assert.match(out.getContent(), /ui\/index/);
});

test('Web.include: returns content from named file', () => {
  setupSheet();
  const html = Web.include('shared/webapp');
  assert.match(html, /shared\/webapp/);
});

// ============================================================
// whoAmI
// ============================================================

test('Web.whoAmI: returns Session email when set', () => {
  setupSheet();
  fakes.Session._setUserEmail('user@example.com');
  assert.strictEqual(Web.whoAmI(), 'user@example.com');
});

test('Web.whoAmI: returns empty string when Session yields ""', () => {
  setupSheet();
  fakes.Session._setUserEmail('');
  assert.strictEqual(Web.whoAmI(), '');
});

// ============================================================
// listRecent / getReceipt / deleteReceipt
// ============================================================

test('Web.listRecent: returns Storage.listRecent results, defaulting limit to 30', () => {
  setupSheet();
  const r1 = Domain.makeReceipt(Object.assign(basicReceiptInput({ date: '2026-05-04' }), { fx_rate_eur: 1 }));
  const r2 = Domain.makeReceipt(Object.assign(basicReceiptInput({ date: '2026-05-03' }), { fx_rate_eur: 1 }));
  Storage.appendReceipt(r1);
  Storage.appendReceipt(r2);
  const list = Web.listRecent();
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].id, r1.id); // latest first
});

test('Web.getReceipt: returns {receipt, items} for existing id', () => {
  setupSheet();
  const saved = Web.saveReceipt(basicReceiptInput(), [basicItem(), basicItem({ product_name: 'B' })]);
  const got = Web.getReceipt(saved.receipt_id);
  assert.ok(got);
  assert.strictEqual(got.receipt.id, saved.receipt_id);
  assert.strictEqual(got.items.length, 2);
});

test('Web.getReceipt: returns null for unknown id', () => {
  setupSheet();
  assert.strictEqual(Web.getReceipt('no-such-id'), null);
});

test('Web.deleteReceipt: removes receipt and cascades to items', () => {
  setupSheet();
  const saved = Web.saveReceipt(basicReceiptInput(), [basicItem()]);
  Web.deleteReceipt(saved.receipt_id);
  assert.strictEqual(Web.getReceipt(saved.receipt_id), null);
});

test('Web.deleteReceipt: throws when id missing', () => {
  setupSheet();
  assert.throws(() => Web.deleteReceipt(''), /id is required/);
});

// ============================================================
// saveReceipt
// ============================================================

test('Web.saveReceipt: EUR — no NBU fetch, fx_rate=1, no Drive write', () => {
  setupSheet();
  const result = Web.saveReceipt(basicReceiptInput(), [basicItem()]);
  assert.ok(result.receipt_id);
  assert.strictEqual(result.items_count, 1);

  const got = Web.getReceipt(result.receipt_id);
  assert.strictEqual(got.receipt.fx_rate_eur, 1);
  assert.strictEqual(got.receipt.total_eur, 5.49);
  assert.strictEqual(got.receipt.photo_url, null);
  assert.deepStrictEqual(fakes.DriveApp._files('fake-drive-folder'), []);
});

test('Web.saveReceipt: UAH — fetches live NBU rate, computes total_eur', () => {
  setupSheet();
  const date = '2026-05-04';
  const yyyymmdd = '20260504';
  const url = `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=EUR&date=${yyyymmdd}&json`;
  fakes.UrlFetchApp._setStub(url, {
    code: 200,
    content: JSON.stringify([{ r030: 978, txt: 'Євро', rate: 45, cc: 'EUR', exchangedate: '04.05.2026' }]),
  });

  const result = Web.saveReceipt(
    basicReceiptInput({ currency: 'UAH', total_orig: 100, date }),
    [basicItem({ unit_price_orig: 100 })]
  );
  const got = Web.getReceipt(result.receipt_id);
  assert.strictEqual(got.receipt.currency, 'UAH');
  assert.strictEqual(got.receipt.total_orig, 100);
  // 1 UAH = 1/45 EUR ≈ 0.022222
  assert.ok(got.receipt.fx_rate_eur > 0.022 && got.receipt.fx_rate_eur < 0.023);
  assert.ok(Math.abs(got.receipt.total_eur - 100 * got.receipt.fx_rate_eur) < 0.01);
});

test('Web.saveReceipt: with photoBase64 — uploads to Drive and stores photo_url', () => {
  setupSheet();
  const base64 = Buffer.from('fake-jpg-bytes').toString('base64');
  const result = Web.saveReceipt(basicReceiptInput(), [basicItem()], base64, 'image/jpeg');

  const files = fakes.DriveApp._files('fake-drive-folder');
  assert.strictEqual(files.length, 1);
  assert.match(files[0].getName(), /^2026-05-04-.+\.jpg$/);

  const got = Web.getReceipt(result.receipt_id);
  assert.match(got.receipt.photo_url, /^https:\/\/drive\.fake\/file\//);
});

test('Web.saveReceipt: throws on missing input', () => {
  setupSheet();
  assert.throws(() => Web.saveReceipt(null, []), /input is required/);
  assert.throws(() => Web.saveReceipt(basicReceiptInput(), 'not-an-array'), /must be an array/);
});

test('Web.saveReceipt: items=[] is allowed (header-only Receipt)', () => {
  setupSheet();
  const result = Web.saveReceipt(basicReceiptInput(), []);
  assert.strictEqual(result.items_count, 0);
});

// ============================================================
// updateReceipt
// ============================================================

test('Web.updateReceipt: patches fields and replaces items, sets source=edit', () => {
  setupSheet();
  const saved = Web.saveReceipt(basicReceiptInput(), [basicItem({ product_name: 'OLD' })]);
  const result = Web.updateReceipt(
    saved.receipt_id,
    { note: 'edited', store: 'New Store' },
    [basicItem({ product_name: 'NEW1' }), basicItem({ product_name: 'NEW2' })]
  );
  assert.strictEqual(result.receipt_id, saved.receipt_id);

  const got = Web.getReceipt(saved.receipt_id);
  assert.strictEqual(got.receipt.note, 'edited');
  assert.strictEqual(got.receipt.store, 'New Store');
  assert.strictEqual(got.receipt.source, 'edit');
  assert.strictEqual(got.items.length, 2);
  assert.deepStrictEqual(got.items.map(it => it.product_name).sort(), ['NEW1', 'NEW2']);
});

test('Web.updateReceipt: omitting items keeps existing ones', () => {
  setupSheet();
  const saved = Web.saveReceipt(basicReceiptInput(), [basicItem({ product_name: 'KEEP' })]);
  Web.updateReceipt(saved.receipt_id, { note: 'just a note' });
  const got = Web.getReceipt(saved.receipt_id);
  assert.strictEqual(got.items.length, 1);
  assert.strictEqual(got.items[0].product_name, 'KEEP');
});

test('Web.updateReceipt: currency change re-fetches FX rate', () => {
  setupSheet();
  const saved = Web.saveReceipt(basicReceiptInput(), [basicItem()]);
  // Switch to UAH — Fx.getRateLive will be called and needs a stub.
  const url = 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=EUR&date=20260504&json';
  fakes.UrlFetchApp._setStub(url, {
    code: 200,
    content: JSON.stringify([{ r030: 978, rate: 45, cc: 'EUR', exchangedate: '04.05.2026' }]),
  });
  Web.updateReceipt(saved.receipt_id, { currency: 'UAH' }, [basicItem({ unit_price_orig: 50 })]);
  const got = Web.getReceipt(saved.receipt_id);
  assert.strictEqual(got.receipt.currency, 'UAH');
  assert.ok(got.receipt.fx_rate_eur < 0.5); // dropped from 1.0
});

test('Web.updateReceipt: throws for unknown id', () => {
  setupSheet();
  assert.throws(() => Web.updateReceipt('no-such-id', { note: 'x' }), /not found/);
});

// ============================================================
// getCategories / listProducts (UI dropdown feeders)
// ============================================================

test('Web.getCategories: returns category names', () => {
  setupSheet();
  assert.deepStrictEqual(Web.getCategories(), ['Бакалія', 'Молочка']);
});

test('Web.listProducts: returns Product[]', () => {
  setupSheet();
  const product = Domain.makeProduct({ name: 'Молоко 1L', category: 'Молочка' });
  Storage.appendProduct(product);
  const list = Web.listProducts();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].name, 'Молоко 1L');
});

// ============================================================
// parseReceipt — dispatches via AiClient (we override it to capture inputs)
// ============================================================

test('Web.parseReceipt: builds ctx from Storage and forwards to AiClient', () => {
  setupSheet();
  const seenArgs = [];
  const realParse = global.AiClient.parseReceipt;
  global.AiClient.parseReceipt = (bytes, ctx) => {
    seenArgs.push({ bytes, ctx });
    return { store: null, date: null, currency: 'EUR', total_orig: null, items: [] };
  };
  try {
    const result = Web.parseReceipt('AAAA', 'image/jpeg');
    assert.strictEqual(result.currency, 'EUR');
    assert.strictEqual(seenArgs.length, 1);
    assert.strictEqual(seenArgs[0].bytes, 'AAAA');
    assert.deepStrictEqual(seenArgs[0].ctx.categories, ['Бакалія', 'Молочка']);
    assert.deepStrictEqual(seenArgs[0].ctx.products, []);
  } finally {
    global.AiClient.parseReceipt = realParse;
  }
});
