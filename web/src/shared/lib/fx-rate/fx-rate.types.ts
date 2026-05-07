// FX rate port. Adapter implementations:
//   - nbu-fx-rate-provider.ts (current; Ukraine NBU)
//   - future: ECB, commercial APIs, etc.
//
// Domain stores the rate on each Receipt at save time (Receipt.fx_rate_eur).
// This service is called once per receipt save, never persisted as its own table.

export type IFxRateProvider = {
  /**
   * Resolve currency→EUR rate for the given date. Returns 1.0 for EUR (no fetch).
   * For UAH (and any future supported currencies) — fetches live from the
   * provider, with provider-specific fallback (e.g. weekend walk-back).
   *
   * @param currency ISO 4217 (e.g. 'EUR', 'UAH')
   * @param dateIso  'YYYY-MM-DD'
   * @returns rate such that `total_eur = total_orig * rate` is correct
   * @throws if the currency is unsupported, or no rate could be resolved
   */
  getRateLive(currency: string, dateIso: string): Promise<number>;
};
