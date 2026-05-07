/**
 * Fx: live currency-to-EUR conversion for UAH (the only non-base currency).
 *
 * Design: rates are fetched on demand from NBU at receipt-save time and
 * stored on the receipt itself (fx_rate_eur, total_eur). No FxRates sheet,
 * no daily trigger, no backfill. The on-receipt audit trail is what we
 * persist; rates are not retained as their own table.
 *
 * Supported currencies: EUR (base, no fetch) and UAH (NBU live).
 * Other currencies throw — extend Fx.getRateLive when a new one is needed.
 *
 * Weekend/holiday fallback: NBU returns an empty array for non-publishing
 * days. We walk back day-by-day up to MAX_LOOKBACK_DAYS until we find a rate.
 *
 * Schema reference: docs/data-model.md
 */

/* exported Fx */
const Fx = {

  /**
   * Resolve rate_to_eur for (currency, date) by hitting the appropriate live
   * source. Stored on the receipt by the caller — never persisted by Fx.
   *
   * @param {string} currency - ISO 4217
   * @param {string} date     - 'YYYY-MM-DD'
   * @returns {number} rate_to_eur (1.0 for EUR; for UAH, 1/NBU EUR-to-UAH rate)
   */
  getRateLive(currency, date) {
    if (currency === Config.BASE_CURRENCY) return 1.0;
    if (currency !== 'UAH') {
      throw new Error(
        `FX lookup not supported for "${currency}". ` +
        'Only EUR (base) and UAH are supported. To add another currency, ' +
        'extend Fx.getRateLive with the appropriate source.'
      );
    }
    return Fx._fetchNbuUahRate(date);
  },

  /**
   * Fetch UAH/EUR rate from NBU for the given date, walking back up to
   * MAX_LOOKBACK_DAYS over weekends/holidays. NBU returns:
   *   [{ rate: 44.6531, exchangedate: "DD.MM.YYYY", cc: "EUR", ... }]
   * `rate` is EUR-to-UAH (1 EUR = N UAH). We invert to get UAH-to-EUR.
   *
   * @param {string} date 'YYYY-MM-DD'
   * @returns {number} rate_to_eur for UAH on that date (or earliest publishing day before it)
   */
  _fetchNbuUahRate(date) {
    const MAX_LOOKBACK_DAYS = 7;
    const target = new Date(`${date}T00:00:00`);
    for (let i = 0; i < MAX_LOOKBACK_DAYS; i++) {
      const d = new Date(target);
      d.setDate(target.getDate() - i);
      const url = `${Config.NBU_RATE_URL}?valcode=EUR&date=${Fx._formatNbuDate(d)}&json`;
      const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (response.getResponseCode() !== 200) continue;
      let data;
      try { data = JSON.parse(response.getContentText()); }
      catch (_e) { continue; }
      if (!Array.isArray(data) || data.length === 0) continue;
      const item = data[0];
      if (!item.rate || typeof item.rate !== 'number') continue;
      return Domain.roundFxRate(1 / item.rate);
    }
    throw new Error(
      `No NBU UAH rate found for ${date} (or any of the ${MAX_LOOKBACK_DAYS} prior days). ` +
      'NBU may be down or your date is too far in the past.'
    );
  },

  /** Date object → 'YYYYMMDD' (NBU URL parameter format). */
  _formatNbuDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  },
};

// CommonJS export for local Node test runner. Apps Script: no-op.
// eslint-disable-next-line no-undef
if (typeof module !== 'undefined') module.exports = { Fx };
