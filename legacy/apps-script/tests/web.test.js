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

test('Web.doGet: known page renders that page (recent.html signature)', () => {
  setupSheet();
  const out = Web.doGet({ parameter: { page: 'recent' } });
  // recent.html has a distinctive H1 in Ukrainian.
  assert.match(out.getContent(), /Останні чеки/);
  assert.strictEqual(out._title, 'Finance Tracker');
});

test('Web.doGet: unknown page falls back to index', () => {
  setupSheet();
  const out = Web.doGet({ parameter: { page: 'no-such-page' } });
  // index.html has a distinctive landing heading.
  assert.match(out.getContent(), /Що додати/);
});

test('Web.doGet: missing parameter falls back to index', () => {
  setupSheet();
  const out = Web.doGet({});
  assert.match(out.getContent(), /Що додати/);
});

test('Web.include: returns shared file content (no scriptlet evaluation)', () => {
  setupSheet();
  // shared/webapp.html contains the runServer Promise wrapper definition.
  const html = Web.include('shared/webapp');
  assert.match(html, /function runServer/);
});

// ============================================================
// Render-truth assertions (Sub-block A)
//
// These tests run the real scriptlet evaluator (tests/fakes/HtmlService.js).
// They prove that <?= ?>, <?!= ?>, <? ?> are processed; that include() is
// followed transitively; that template variables propagate; and that no
// unevaluated <? ... ?> residue ends up in the rendered output. A regression
// would have surfaced the "blank page" Phase 3 bug locally.
// ============================================================

test('Render: index has <base href> populated from scriptUrl', () => {
  setupSheet();
  const out = Web.doGet({ parameter: { page: 'index' } });
  // ScriptApp fake returns a deployment-shaped URL by default.
  assert.match(out.getContent(), /<base href="https:\/\/script\.google\.com\/macros\/[^"]*" target="_top">/);
});

test('Render: no unevaluated scriptlet residue in any page', () => {
  setupSheet();
  for (const page of Web.PAGES) {
    const html = Web.doGet({ parameter: { page } }).getContent();
    const idx = html.indexOf('<?');
    if (idx !== -1) {
      const start = Math.max(0, idx - 80);
      const end = Math.min(html.length, idx + 160);
      assert.fail(`page "${page}" still contains a literal <? at offset ${idx}:\n…${html.slice(start, end)}…`);
    }
    assert.ok(html.length > 200, `page "${page}" rendered empty/short — body suspicious`);
  }
});

test('Render: index transitively includes shared/styles content', () => {
  setupSheet();
  const html = Web.doGet({ parameter: { page: 'index' } }).getContent();
  // styles.html starts with `<style>` and defines :root CSS vars. Pick a token
  // that uniquely identifies the shared stylesheet.
  assert.match(html, /--accent:/);
});

test('Render: shared/webapp script body present (transitive include)', () => {
  setupSheet();
  const html = Web.doGet({ parameter: { page: 'index' } }).getContent();
  assert.match(html, /function runServer/);
});

test('Render: edit page queryParams meta carries the id', () => {
  setupSheet();
  const html = Web.doGet({ parameter: { page: 'edit', id: 'ABC123' } }).getContent();
  // <meta name="finance-query-params" content='{"page":"edit","id":"ABC123"}'>
  // <?= ?> HTML-escapes JSON quotes → &quot;.
  assert.match(html, /name="finance-query-params"/);
  assert.match(html, /&quot;id&quot;:&quot;ABC123&quot;/);
});

test('Render: every page declares <base target="_top"> (iframe nav guard)', () => {
  setupSheet();
  for (const page of Web.PAGES) {
    const html = Web.doGet({ parameter: { page } }).getContent();
    assert.match(html, /<base [^>]*target="_top"/, `page "${page}" missing <base target="_top"> — iframe nav will break`);
  }
});

// ============================================================
// whoAmI
// ============================================================

test('Web.whoAmI: returns the authorized accessing user email (lowercased)', () => {
  setupSheet();
  fakes.Session._setUserEmail('Zhidetskij@gmail.com'); // mixed case
  assert.strictEqual(Web.whoAmI(), 'user2@example.com');
});

// ============================================================
// Authorization (allowlist gate)
// ============================================================

test('Authz: doGet renders denied page for non-allowlisted email', () => {
  setupSheet();
  fakes.Session._setUserEmail('intruder@example.com');
  const out = Web.doGet({ parameter: { page: 'index' } });
  assert.match(out.getContent(), /Доступ обмежено/);
  assert.match(out.getContent(), /intruder@example\.com/);
});

test('Authz: doGet denies anonymous (empty email)', () => {
  setupSheet();
  fakes.Session._setUserEmail('');
  const out = Web.doGet({ parameter: { page: 'index' } });
  assert.match(out.getContent(), /Доступ обмежено/);
});

test('Authz: doGet allows allowlisted user (renders the requested page)', () => {
  setupSheet();
  fakes.Session._setUserEmail('user1@example.com');
  const out = Web.doGet({ parameter: { page: 'index' } });
  assert.match(out.getContent(), /Що додати/);
  assert.ok(!out.getContent().includes('Доступ обмежено'));
});

test('Authz: runServer endpoints throw "Access denied" for outsiders', () => {
  setupSheet();
  fakes.Session._setUserEmail('intruder@example.com');
  assert.throws(() => Web.listRecent(), /Access denied/);
  assert.throws(() => Web.getCategories(), /Access denied/);
  assert.throws(() => Web.listProducts(), /Access denied/);
  assert.throws(() => Web.saveReceipt(basicReceiptInput(), [basicItem()]), /Access denied/);
  assert.throws(() => Web.deleteReceipt('any-id'), /Access denied/);
  assert.throws(() => Web.parseReceipt('YQ==', 'image/jpeg'), /Access denied/);
});

test('Authz: case-insensitive email match', () => {
  setupSheet();
  fakes.Session._setUserEmail('ZHIDETSKIJ@GMAIL.COM');
  assert.doesNotThrow(() => Web.listRecent());
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

test('Web.saveReceipt: stores negative-price items (Pfand refund / cancellation)', () => {
  setupSheet();
  // Mirrors the EDEKA-receipt regression: a positive product line plus a
  // matching negative-price line (cancellation), plus a Pfand deposit refund.
  const items = [
    basicItem({ product_name: 'Mayb.Rose AF 0,75l', unit_price_orig: 2.99 }),
    basicItem({ product_name: 'Mayb.Rose AF 0,75l', unit_price_orig: -2.99 }),
    basicItem({ product_name: 'Leergut Einw.allg.', unit_price_orig: -8.25 }),
  ];
  const input = basicReceiptInput({ total_orig: 2.99 + (-2.99) + (-8.25) });
  const result = Web.saveReceipt(input, items);
  assert.strictEqual(result.items_count, 3);

  const got = Web.getReceipt(result.receipt_id);
  // The receipt's stored total_orig was rounded by Domain.makeReceipt — verify
  // it's the arithmetic the user would expect.
  assert.strictEqual(got.receipt.total_orig, -8.25);
  assert.strictEqual(got.receipt.total_eur, -8.25);
  // Per-item negatives propagated to total_orig / total_eur.
  const cancellation = got.items.find(it => it.product_name === 'Mayb.Rose AF 0,75l' && it.unit_price_orig < 0);
  assert.ok(cancellation, 'cancellation item missing');
  assert.strictEqual(cancellation.total_orig, -2.99);
  assert.strictEqual(cancellation.total_eur, -2.99);
  const refund = got.items.find(it => it.product_name === 'Leergut Einw.allg.');
  assert.strictEqual(refund.total_orig, -8.25);
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
