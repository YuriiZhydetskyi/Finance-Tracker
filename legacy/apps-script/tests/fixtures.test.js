/**
 * Drift-detection tests against real-world NBU JSON fixture.
 *
 * Why: NBU is now our only external rate source. If the response shape
 * changes (field names, date format), Fx.getRateLive breaks at runtime.
 * This test pins the shape so we notice early.
 *
 * To refresh fixture (after intentional NBU format change):
 *   curl 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=EUR&date=YYYYMMDD&json' \
 *        > tests/fixtures/nbu-uah-sample.json
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

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

test('NBU fixture: rate is plausible for UAH (10 < EUR-to-UAH < 100)', () => {
  const json = fs.readFileSync(path.join(FIXTURES_DIR, 'nbu-uah-sample.json'), 'utf8');
  const data = JSON.parse(json);
  // 1 EUR has historically been 10-50 UAH; allow wider range for future drift.
  assert.ok(data[0].rate > 10 && data[0].rate < 100,
    `EUR-to-UAH rate ${data[0].rate} is outside plausible range`);
});
