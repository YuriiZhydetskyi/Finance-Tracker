/**
 * Configuration: Script Properties accessors + public constants.
 *
 * Three categories of config values:
 *   1. Resource IDs and secrets — stored in Apps Script Properties (not in code).
 *      Set them in: Apps Script editor → Project Settings → Script Properties.
 *   2. Public constants — hardcoded here (in Git).
 *   3. Display aliases — fill in once both real emails are confirmed.
 *
 * Required Script Properties (must be set before running anything):
 *   - SHEET_ID
 *   - DRIVE_FOLDER_ID  (only required from Phase 3 onward)
 *   - GEMINI_API_KEY   (only required from Phase 2 onward)
 */

/* exported Config */
const Config = {
  // ===== Script-Properties-backed (lazy getters) =====

  get SHEET_ID() { return _Config_requireProp('SHEET_ID'); },
  get DRIVE_FOLDER_ID() { return _Config_requireProp('DRIVE_FOLDER_ID'); },
  get GEMINI_API_KEY() { return _Config_requireProp('GEMINI_API_KEY'); },

  // ===== Public constants =====

  /** @type {'gemini' | 'openai' | 'anthropic'} */
  AI_PROVIDER: 'gemini',

  TIMEZONE: 'Europe/Berlin',
  BASE_CURRENCY: 'EUR',

  /** Decimal places used by Domain rounding helpers and Storage write contract. */
  MONEY_DECIMALS: 2,
  FX_RATE_DECIMALS: 6,
  QTY_DECIMALS: 3,

  /** LockService timeout for multi-row writes (ms). */
  LOCK_TIMEOUT_MS: 30000,

  /** Sheet tab names. Must match the Sheet tabs exactly. */
  SHEETS: {
    RECEIPTS: 'Receipts',
    ITEMS: 'Items',
    PRODUCTS: 'Products',
    CATEGORIES: 'Categories',
    FX_RATES: 'FxRates',
  },

  /** Display alias map: email → human label (used by UI; not stored in Sheet). */
  EMAIL_ALIASES: {
    // 'yurii@example.com': 'Я',
    // 'fiancee@example.com': 'Вона',
  },

  /** ECB feed URLs (see Fx.js). */
  ECB_DAILY_URL: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
  ECB_HIST_90D_URL: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml',
};

function _Config_requireProp(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) {
    throw new Error(
      `Missing Script Property: "${key}". ` +
      'Set it via Apps Script editor → Project Settings → Script Properties.'
    );
  }
  return value;
}
