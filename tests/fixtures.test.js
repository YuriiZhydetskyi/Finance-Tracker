/**
 * Drift-detection tests against real-world XML/JSON fixtures.
 *
 * Why: catches assumption violations early. The historical example: I assumed
 * UAH was in ECB feed; it isn't. A test asserting "ECB sample contains
 * USD/GBP/PLN" and "ECB sample does NOT contain UAH" would have caught my
 * mistaken assumption before code was written.
 *
 * To refresh fixtures (after intentional ECB/NBU format changes):
 *   curl https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml \
 *        > tests/fixtures/ecb-daily-sample.xml
 *   curl 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=EUR&date=YYYYMMDD&json' \
 *        > tests/fixtures/nbu-uah-sample.json
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { Fx } = require('./bootstrap');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

// ============================================================
// ECB
// ============================================================

test('ECB fixture: contains expected major currencies', () => {
  const xml = fs.readFileSync(path.join(FIXTURES_DIR, 'ecb-daily-sample.xml'), 'utf8');
  const rates = Fx._parseEcbXml(xml);
  const currencies = new Set(rates.map(r => r.currency));

  // Major reference currencies — if ECB ever drops one of these, our
  // assumptions about coverage break and we want to know early.
  const expected = ['USD', 'JPY', 'GBP', 'CHF', 'PLN', 'CZK', 'HUF', 'CAD', 'AUD'];
  for (const code of expected) {
    assert.ok(currencies.has(code), `ECB feed must contain ${code} (got: ${[...currencies].join(', ')})`);
  }
});

test('ECB fixture: does NOT contain UAH (documented absence)', () => {
  const xml = fs.readFileSync(path.join(FIXTURES_DIR, 'ecb-daily-sample.xml'), 'utf8');
  const rates = Fx._parseEcbXml(xml);
  const currencies = new Set(rates.map(r => r.currency));

  assert.ok(
    !currencies.has('UAH'),
    'UAH is not published by ECB. If this assertion ever passes, NBU integration ' +
    'in src/Fx.js may be redundant — re-evaluate the FX source strategy.'
  );
});

test('ECB fixture: USD rate is plausible (0.5 < x < 2)', () => {
  const xml = fs.readFileSync(path.join(FIXTURES_DIR, 'ecb-daily-sample.xml'), 'utf8');
  const rates = Fx._parseEcbXml(xml);
  const usd = rates.find(r => r.currency === 'USD');
  assert.ok(usd);
  // rate_to_eur for USD: 1 USD ≈ 0.85-1.15 EUR. Sanity check.
  assert.ok(usd.rate_to_eur > 0.5 && usd.rate_to_eur < 2,
    `USD rate ${usd.rate_to_eur} is outside plausible range — feed format may have changed`);
});

test('ECB fixture: parser produces rate_to_eur (inverted from EUR-to-CCY)', () => {
  const xml = fs.readFileSync(path.join(FIXTURES_DIR, 'ecb-daily-sample.xml'), 'utf8');
  const rates = Fx._parseEcbXml(xml);
  const usd = rates.find(r => r.currency === 'USD');
  // Sample has USD rate=1.1700 (EUR-to-USD). Inverted: 1/1.17 ≈ 0.854701.
  assert.ok(Math.abs(usd.rate_to_eur - 0.854701) < 0.0001,
    `Expected rate_to_eur ≈ 0.854701, got ${usd.rate_to_eur}`);
});

// ============================================================
// NBU
// ============================================================

test('NBU fixture: parses to expected shape', () => {
  const json = fs.readFileSync(path.join(FIXTURES_DIR, 'nbu-uah-sample.json'), 'utf8');
  const data = JSON.parse(json);
  assert.ok(Array.isArray(data));
  assert.ok(data.length > 0);

  const item = data[0];
  assert.strictEqual(item.cc, 'EUR');
  assert.ok(typeof item.rate === 'number');
  assert.ok(/^\d{2}\.\d{2}\.\d{4}$/.test(item.exchangedate),
    `exchangedate must be DD.MM.YYYY, got "${item.exchangedate}"`);
});

test('NBU fixture: _parseNbuDate converts exchangedate to YYYY-MM-DD', () => {
  const json = fs.readFileSync(path.join(FIXTURES_DIR, 'nbu-uah-sample.json'), 'utf8');
  const data = JSON.parse(json);
  const iso = Fx._parseNbuDate(data[0].exchangedate);
  assert.match(iso, /^\d{4}-\d{2}-\d{2}$/);
});

test('NBU fixture: rate is plausible for UAH (10 < EUR-to-UAH < 100)', () => {
  const json = fs.readFileSync(path.join(FIXTURES_DIR, 'nbu-uah-sample.json'), 'utf8');
  const data = JSON.parse(json);
  // 1 EUR has historically been 10-50 UAH; allow wider range for future drift.
  assert.ok(data[0].rate > 10 && data[0].rate < 100,
    `EUR-to-UAH rate ${data[0].rate} is outside plausible range`);
});
