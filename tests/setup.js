/**
 * Apps Script global stubs for Node-side unit tests.
 *
 * Domain.js calls Utilities.formatDate() inside time helpers and reads
 * Config.* constants in rounding helpers and validators. Stubs below give
 * those identifiers sensible Node-friendly behavior so the module loads and
 * its pure logic can be tested without an Apps Script runtime.
 */

global.Utilities = {
  /**
   * Mimic Apps Script's Utilities.formatDate for the two patterns we use:
   *   - 'yyyy-MM-dd'                  → 'YYYY-MM-DD'
   *   - "yyyy-MM-dd'T'HH:mm:ssXXX"    → 'YYYY-MM-DDTHH:MM:SS+00:00'
   * Other patterns fall through to ISO string.
   */
  formatDate(date, _tz, fmt) {
    const iso = date.toISOString();          // 2026-05-04T14:30:00.123Z
    if (fmt === 'yyyy-MM-dd') return iso.slice(0, 10);
    return iso.replace(/\.\d{3}Z$/, '+00:00');
  },
};

global.Config = {
  TIMEZONE: 'UTC',
  BASE_CURRENCY: 'EUR',
  MONEY_DECIMALS: 2,
  FX_RATE_DECIMALS: 6,
  QTY_DECIMALS: 3,
};
