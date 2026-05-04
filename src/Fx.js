/**
 * Fx: fetch ECB Reference Rates and resolve currency → EUR conversion.
 *
 * ECB feeds:
 *   - daily.xml      — most recent business-day rates (~1KB)
 *   - hist-90d.xml   — last 90 business days (~80KB) — used for backfill
 *
 * Note on rate direction: ECB publishes EUR-to-CCY rates (1 EUR = X CCY).
 * Our schema (FxRates.rate_to_eur) stores CCY-to-EUR (1 CCY = X EUR), i.e.
 * the reciprocal. For EUR itself, rate_to_eur is always 1.0 and is not
 * stored in the FxRates sheet — Fx.getRate short-circuits.
 *
 * FX fallback rule: if no rate exists for the requested date, return the
 * latest available rate ≤ requested date. This handles weekends and ECB
 * holidays (no publishing on Sat/Sun/EU holidays).
 *
 * Schema reference: docs/data-model.md (FX fallback rule section)
 */

/* exported Fx */
const Fx = {

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Fetch the most recent rates and append to FxRates sheet (skipping
   * duplicates). Intended to run as a daily time trigger. Combines:
   *   - ECB Reference Rates (~30 major currencies)
   *   - NBU (UAH only, since ECB does not publish UAH)
   * @returns {number} count of new rate rows appended
   */
  refreshDaily() {
    const ecbAdded = Fx._fetchEcbAndAppend(Config.ECB_DAILY_URL);
    const nbuAdded = Fx._fetchNbuUahDaysAndAppend(0);  // 0 = today only
    return ecbAdded + nbuAdded;
  },

  /**
   * Backfill last 90 business days from ECB and NBU. Use once at setup;
   * then daily refresh keeps the sheet up to date.
   * @returns {number} count of new rate rows appended
   */
  backfill90Days() {
    const ecbAdded = Fx._fetchEcbAndAppend(Config.ECB_HIST_90D_URL);
    const nbuAdded = Fx._fetchNbuUahDaysAndAppend(90);
    return ecbAdded + nbuAdded;
  },

  /**
   * Resolve rate_to_eur for a (currency, date) pair, applying the fallback rule.
   * @param {string} currency - ISO 4217
   * @param {string} date     - 'YYYY-MM-DD'
   * @returns {number} rate_to_eur (1.0 for the base currency)
   */
  getRate(currency, date) {
    if (currency === Config.BASE_CURRENCY) return 1.0;
    const all = Storage.listFxRates();
    let bestRate = null;
    let bestDate = null;
    for (const r of all) {
      if (r.currency !== currency) continue;
      if (r.date > date) continue;
      if (!bestDate || r.date > bestDate) {
        bestDate = r.date;
        bestRate = r.rate_to_eur;
      }
    }
    if (bestRate === null) {
      throw new Error(
        `No FX rate found for ${currency} ≤ ${date}. ` +
        'Run Fx.backfill90Days() first or check that ECB publishes this currency.'
      );
    }
    return bestRate;
  },

  /**
   * Install a daily time trigger for refreshDaily(). Idempotent — replaces
   * any existing trigger with the same handler.
   */
  installDailyTrigger() {
    // Remove any prior trigger pointing at this handler
    ScriptApp.getProjectTriggers().forEach(t => {
      if (t.getHandlerFunction() === 'fxDailyTriggerHandler') {
        ScriptApp.deleteTrigger(t);
      }
    });
    ScriptApp.newTrigger('fxDailyTriggerHandler')
      .timeBased()
      .everyDays(1)
      .atHour(8)  // 08:00 Berlin local; ECB publishes around 16:00 CET, so previous-day data is settled
      .create();
  },

  // ============================================================
  // Internal: ECB
  // ============================================================

  /**
   * Fetch ECB XML feed at the given URL, parse it, append to FxRates.
   * @param {string} url
   * @returns {number} count of new rate rows appended
   */
  _fetchEcbAndAppend(url) {
    const xml = UrlFetchApp.fetch(url, { muteHttpExceptions: false }).getContentText();
    const rates = Fx._parseEcbXml(xml);
    return Storage.appendFxRates(rates);
  },

  // ============================================================
  // Internal: NBU (Ukrainian Hryvnia source)
  // ============================================================

  /**
   * Fetch UAH rate from NBU for a window of days back from today.
   * NBU API takes one date per request, so we batch via UrlFetchApp.fetchAll
   * for parallelism. Skip dates where NBU returns empty (weekends/holidays);
   * the FX fallback rule in getRate() handles missing dates.
   *
   * NBU response shape (per request, single-element array):
   *   [{ "rate": 44.6531, "exchangedate": "04.05.2026", "cc": "EUR", ... }]
   * `rate` = how many UAH per 1 EUR. We invert to get rate_to_eur.
   *
   * @param {number} daysBack 0 = today only; 90 = last ~90 days
   * @returns {number} count of new rate rows appended
   */
  _fetchNbuUahDaysAndAppend(daysBack) {
    const today = new Date();
    const requests = [];
    for (let i = 0; i <= daysBack; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      requests.push({
        url: `${Config.NBU_RATE_URL}?valcode=EUR&date=${Fx._formatNbuDate(d)}&json`,
        muteHttpExceptions: true,
      });
    }
    const responses = UrlFetchApp.fetchAll(requests);
    const rates = [];
    for (const r of responses) {
      if (r.getResponseCode() !== 200) continue;
      let data;
      try { data = JSON.parse(r.getContentText()); }
      catch (_e) { continue; }
      if (!Array.isArray(data) || data.length === 0) continue;
      const item = data[0];
      if (!item.rate || !item.exchangedate) continue;
      rates.push({
        date: Fx._parseNbuDate(item.exchangedate),
        currency: 'UAH',
        rate_to_eur: Domain.roundFxRate(1 / item.rate),
      });
    }
    return Storage.appendFxRates(rates);
  },

  /** 'DD.MM.YYYY' (NBU format) → 'YYYY-MM-DD' (our schema). */
  _parseNbuDate(ddmmyyyy) {
    const [d, m, y] = ddmmyyyy.split('.');
    return `${y}-${m}-${d}`;
  },

  /** Date object → 'YYYYMMDD' (NBU URL format). */
  _formatNbuDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  },

  // ============================================================
  // Internal: ECB XML parsing
  // ============================================================

  /**
   * Parse an ECB euroFxref XML feed (either daily or hist-90d).
   * @returns {Array<{date:string, currency:string, rate_to_eur:number}>}
   */
  _parseEcbXml(xml) {
    const document = XmlService.parse(xml);
    const root = document.getRootElement();
    const refNs = XmlService.getNamespace('http://www.ecb.int/vocabulary/2002-08-01/eurofxref');
    const outerCube = root.getChild('Cube', refNs);
    if (!outerCube) {
      throw new Error('ECB XML: outer Cube element not found. Feed format may have changed.');
    }
    const dateCubes = outerCube.getChildren('Cube', refNs);
    const result = [];
    for (const dc of dateCubes) {
      const timeAttr = dc.getAttribute('time');
      if (!timeAttr) continue;
      const date = timeAttr.getValue();
      const currencyCubes = dc.getChildren('Cube', refNs);
      for (const cc of currencyCubes) {
        const currency = cc.getAttribute('currency').getValue();
        const rateEurToCcy = parseFloat(cc.getAttribute('rate').getValue());
        if (!isFinite(rateEurToCcy) || rateEurToCcy === 0) continue;
        const rate_to_eur = Domain.roundFxRate(1 / rateEurToCcy);
        result.push({ date, currency, rate_to_eur });
      }
    }
    return result;
  },
};

/**
 * Top-level handler used by the daily time trigger. Apps Script triggers
 * dispatch by function name, so we expose this thin wrapper at the global level.
 */
/* exported fxDailyTriggerHandler */
function fxDailyTriggerHandler() {
  Fx.refreshDaily();
}
