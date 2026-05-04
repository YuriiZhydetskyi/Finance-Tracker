/**
 * Integration tests for src/Fx.js using fakes for UrlFetchApp + XmlService.
 *
 * Covers:
 *   - getRate: returns 1.0 for BASE_CURRENCY without lookup
 *   - getRate: fallback rule (latest available rate ≤ requested date)
 *   - getRate: throws when no rate available
 *   - _parseEcbXml: parses sample XML, returns expected shape
 *   - _parseNbuDate / _formatNbuDate: pure round-trip
 *   - _fetchEcbAndAppend: writes to FxRates, dedupes
 *   - _fetchNbuUahDaysAndAppend: handles 200/non-200 responses
 */

const test = require('node:test');
const assert = require('node:assert');

const { fakes, resetAllFakes, Fx, Storage } = require('./bootstrap');

const SHEETS = ['Receipts', 'Items', 'Products', 'Categories', 'FxRates'];
const HEADERS = {
  Receipts: ['id', 'date', 'store', 'currency', 'total_orig', 'fx_rate_eur', 'total_eur', 'paid_by', 'photo_url', 'source', 'raw_ocr_json', 'note', 'created_at', 'updated_at'],
  Items: ['id', 'receipt_id', 'product_id', 'product_name', 'category', 'qty', 'unit_price_orig', 'total_orig', 'total_eur', 'consumed_by', 'note', 'wasted_qty', 'created_at', 'updated_at'],
  Products: ['id', 'name', 'category', 'unit', 'unit_size', 'notes', 'created_at', 'updated_at'],
  Categories: ['name', 'group'],
  FxRates: ['date', 'currency', 'rate_to_eur'],
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

// Sample ECB XML matching the real feed structure (USD + GBP, two dates).
const ECB_SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <gesmes:Sender>
    <gesmes:name>European Central Bank</gesmes:name>
  </gesmes:Sender>
  <Cube>
    <Cube time="2026-05-02">
      <Cube currency="USD" rate="1.0750"/>
      <Cube currency="GBP" rate="0.8500"/>
    </Cube>
    <Cube time="2026-05-01">
      <Cube currency="USD" rate="1.0800"/>
      <Cube currency="GBP" rate="0.8520"/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

// ============================================================
// _parseEcbXml
// ============================================================

test('Fx._parseEcbXml: parses sample XML', () => {
  const rates = Fx._parseEcbXml(ECB_SAMPLE_XML);
  assert.strictEqual(rates.length, 4);

  const usd0502 = rates.find(r => r.currency === 'USD' && r.date === '2026-05-02');
  assert.ok(usd0502);
  assert.strictEqual(usd0502.rate_to_eur, Math.round((1 / 1.075) * 1e6) / 1e6);

  const currencies = new Set(rates.map(r => r.currency));
  assert.ok(currencies.has('USD'));
  assert.ok(currencies.has('GBP'));
});

test('Fx._parseEcbXml: throws on malformed XML', () => {
  assert.throws(() => Fx._parseEcbXml('<not-ecb/>'), /outer Cube element/);
});

// ============================================================
// NBU date helpers (pure)
// ============================================================

test('Fx._parseNbuDate: DD.MM.YYYY → YYYY-MM-DD', () => {
  assert.strictEqual(Fx._parseNbuDate('04.05.2026'), '2026-05-04');
  assert.strictEqual(Fx._parseNbuDate('31.12.2025'), '2025-12-31');
});

test('Fx._formatNbuDate: Date → YYYYMMDD', () => {
  assert.strictEqual(Fx._formatNbuDate(new Date(2026, 4, 4)), '20260504'); // month is 0-indexed
  assert.strictEqual(Fx._formatNbuDate(new Date(2025, 11, 31)), '20251231');
});

// ============================================================
// _fetchEcbAndAppend
// ============================================================

test('Fx._fetchEcbAndAppend: writes parsed rates to FxRates', () => {
  setupSheet();
  fakes.UrlFetchApp._setStub('https://example.com/ecb.xml', { content: ECB_SAMPLE_XML });
  const added = Fx._fetchEcbAndAppend('https://example.com/ecb.xml');
  assert.strictEqual(added, 4);

  const allRates = Storage.listFxRates();
  assert.strictEqual(allRates.length, 4);
});

test('Fx._fetchEcbAndAppend: dedupes existing (date, currency) pairs', () => {
  setupSheet();
  fakes.UrlFetchApp._setStub('https://example.com/ecb.xml', { content: ECB_SAMPLE_XML });
  Fx._fetchEcbAndAppend('https://example.com/ecb.xml');
  const second = Fx._fetchEcbAndAppend('https://example.com/ecb.xml');
  assert.strictEqual(second, 0);
  assert.strictEqual(Storage.listFxRates().length, 4);
});

// ============================================================
// _fetchNbuUahDaysAndAppend
// ============================================================

test('Fx._fetchNbuUahDaysAndAppend: parses successful response', () => {
  setupSheet();
  // For daysBack=0 (today only), one URL is fetched.
  const today = new Date();
  const dateStr = Fx._formatNbuDate(today);
  const isoDate = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  // NBU returns YYYY-MM-DD as DD.MM.YYYY
  const ddmmyyyy = `${String(today.getDate()).padStart(2,'0')}.${String(today.getMonth()+1).padStart(2,'0')}.${today.getFullYear()}`;

  const url = `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=EUR&date=${dateStr}&json`;
  fakes.UrlFetchApp._setStub(url, {
    content: JSON.stringify([{
      r030: 978, txt: 'Євро', rate: 44.6531, cc: 'EUR', exchangedate: ddmmyyyy,
    }]),
  });

  const added = Fx._fetchNbuUahDaysAndAppend(0);
  assert.strictEqual(added, 1);

  const rates = Storage.listFxRates();
  assert.strictEqual(rates.length, 1);
  assert.strictEqual(rates[0].currency, 'UAH');
  assert.strictEqual(rates[0].date, isoDate);
  assert.strictEqual(rates[0].rate_to_eur, Math.round((1 / 44.6531) * 1e6) / 1e6);
});

test('Fx._fetchNbuUahDaysAndAppend: skips dates with no stub (404 in fake)', () => {
  setupSheet();
  // No stubs registered → fake returns 404 for all → 0 rates appended.
  const added = Fx._fetchNbuUahDaysAndAppend(2);
  assert.strictEqual(added, 0);
});

// ============================================================
// getRate
// ============================================================

test('Fx.getRate: returns 1.0 for BASE_CURRENCY (EUR)', () => {
  setupSheet();
  assert.strictEqual(Fx.getRate('EUR', '2026-05-04'), 1.0);
});

test('Fx.getRate: throws when no rate available', () => {
  setupSheet();
  assert.throws(() => Fx.getRate('USD', '2026-05-04'), /No FX rate found/);
});

test('Fx.getRate: returns exact match', () => {
  setupSheet();
  Storage.appendFxRates([{ date: '2026-05-04', currency: 'USD', rate_to_eur: 0.93 }]);
  assert.strictEqual(Fx.getRate('USD', '2026-05-04'), 0.93);
});

test('Fx.getRate: applies fallback (latest ≤ date)', () => {
  setupSheet();
  Storage.appendFxRates([
    { date: '2026-05-01', currency: 'USD', rate_to_eur: 0.92 },
    { date: '2026-05-03', currency: 'USD', rate_to_eur: 0.93 },
    { date: '2026-05-05', currency: 'USD', rate_to_eur: 0.94 },
  ]);

  // Sunday — no rate. Fallback to Friday's 0.93.
  assert.strictEqual(Fx.getRate('USD', '2026-05-04'), 0.93);
});

test('Fx.getRate: throws when only future rates exist', () => {
  setupSheet();
  Storage.appendFxRates([
    { date: '2026-05-10', currency: 'USD', rate_to_eur: 0.95 },
  ]);
  assert.throws(() => Fx.getRate('USD', '2026-05-04'), /No FX rate found/);
});
