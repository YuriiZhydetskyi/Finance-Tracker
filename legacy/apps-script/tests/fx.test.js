/**
 * Integration tests for src/Fx.js (live UAH lookup via NBU).
 *
 * Covers:
 *   - getRateLive returns 1.0 for EUR (no fetch)
 *   - getRateLive throws for unsupported currencies
 *   - getRateLive('UAH', date) parses NBU response and returns rate_to_eur
 *   - Walk-back behavior over weekends/empty NBU responses
 *   - Throws after exhausting MAX_LOOKBACK_DAYS
 *   - _formatNbuDate (pure)
 */

const test = require('node:test');
const assert = require('node:assert');

const { fakes, resetAllFakes, Fx } = require('./bootstrap');

function nbuUrl(yyyymmdd) {
  return `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=EUR&date=${yyyymmdd}&json`;
}

function nbuResponse(rate, exchangedate) {
  return {
    content: JSON.stringify([{
      r030: 978, txt: 'Євро', rate, cc: 'EUR', exchangedate,
    }]),
  };
}

// ============================================================
// _formatNbuDate (pure)
// ============================================================

test('Fx._formatNbuDate: Date → YYYYMMDD', () => {
  assert.strictEqual(Fx._formatNbuDate(new Date(2026, 4, 4)), '20260504'); // month is 0-indexed
  assert.strictEqual(Fx._formatNbuDate(new Date(2025, 11, 31)), '20251231');
});

// ============================================================
// getRateLive: short-circuits and unsupported currencies
// ============================================================

test('Fx.getRateLive: returns 1.0 for EUR without fetching', () => {
  resetAllFakes();
  // No stubs registered — would 404 if a fetch happened.
  assert.strictEqual(Fx.getRateLive('EUR', '2026-05-04'), 1.0);
});

test('Fx.getRateLive: throws for unsupported currency', () => {
  resetAllFakes();
  assert.throws(() => Fx.getRateLive('USD', '2026-05-04'), /not supported/);
  assert.throws(() => Fx.getRateLive('PLN', '2026-05-04'), /not supported/);
});

// ============================================================
// getRateLive: UAH happy path
// ============================================================

test('Fx.getRateLive: UAH returns inverted NBU rate', () => {
  resetAllFakes();
  fakes.UrlFetchApp._setStub(nbuUrl('20260504'), nbuResponse(44.6531, '04.05.2026'));

  const rate = Fx.getRateLive('UAH', '2026-05-04');
  // NBU returns EUR-to-UAH; we store UAH-to-EUR (the reciprocal), rounded to 6dp.
  assert.strictEqual(rate, Math.round((1 / 44.6531) * 1e6) / 1e6);
});

// ============================================================
// getRateLive: weekend/holiday walk-back
// ============================================================

test('Fx.getRateLive: walks back when NBU returns empty array', () => {
  resetAllFakes();
  // Sunday — empty. Saturday — empty. Friday — has rate.
  fakes.UrlFetchApp._setStub(nbuUrl('20260503'), { content: '[]' }); // Sun
  fakes.UrlFetchApp._setStub(nbuUrl('20260502'), { content: '[]' }); // Sat
  fakes.UrlFetchApp._setStub(nbuUrl('20260501'), nbuResponse(44.50, '01.05.2026')); // Fri

  const rate = Fx.getRateLive('UAH', '2026-05-03');
  assert.strictEqual(rate, Math.round((1 / 44.50) * 1e6) / 1e6);
});

test('Fx.getRateLive: walks back across non-200 responses', () => {
  resetAllFakes();
  // Day-0 returns 500 (NBU hiccup); day-1 returns the rate.
  fakes.UrlFetchApp._setStub(nbuUrl('20260504'), { code: 500, content: 'oops' });
  fakes.UrlFetchApp._setStub(nbuUrl('20260503'), nbuResponse(44.0, '03.05.2026'));

  const rate = Fx.getRateLive('UAH', '2026-05-04');
  assert.strictEqual(rate, Math.round((1 / 44.0) * 1e6) / 1e6);
});

test('Fx.getRateLive: throws after exhausting lookback window', () => {
  resetAllFakes();
  // No stubs — every fetch returns 404. Should walk 7 days and give up.
  assert.throws(() => Fx.getRateLive('UAH', '2026-05-04'), /No NBU UAH rate found/);
});
