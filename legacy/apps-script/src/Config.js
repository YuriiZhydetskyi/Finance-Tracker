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
 *   - DRIVE_FOLDER_ID    (only required from Phase 3 onward)
 *   - GEMINI_API_KEY     (only required from Phase 2 onward)
 *   - ANTHROPIC_API_KEY  (only required from Phase 3.6 onward — Claude fallback, ADR-0011)
 */

/* exported Config */
const Config = {
  // ===== Script-Properties-backed (lazy getters) =====

  get SHEET_ID() { return _Config_requireProp('SHEET_ID'); },
  get DRIVE_FOLDER_ID() { return _Config_requireProp('DRIVE_FOLDER_ID'); },
  get GEMINI_API_KEY() { return _Config_requireProp('GEMINI_API_KEY'); },
  get ANTHROPIC_API_KEY() { return _Config_requireProp('ANTHROPIC_API_KEY'); },

  // ===== Public constants =====

  /** @type {'gemini' | 'openai' | 'anthropic'} */
  AI_PROVIDER: 'gemini',

  /** Gemini parameters. Per ADR-0003. */
  GEMINI_MODEL: 'gemini-3-flash-preview',
  GEMINI_API_URL_BASE: 'https://generativelanguage.googleapis.com/v1beta/models',
  AI_TEMPERATURE: 0.1,

  /** Anthropic parameters (Claude fallback when Gemini fails). Per ADR-0011. */
  ANTHROPIC_MODEL: 'claude-sonnet-4-6',
  ANTHROPIC_API_URL: 'https://api.anthropic.com/v1/messages',
  ANTHROPIC_VERSION: '2023-06-01',
  ANTHROPIC_MAX_TOKENS: 4096,

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
  },

  /**
   * Server-side allowlist. Web.doGet and every google.script.run endpoint
   * compare Session.getEffectiveUser().getEmail() against this list. Anyone
   * else gets a denied page (or a thrown error for runServer calls).
   *
   * Apps Script's webapp.access manifest enum has no "list of specific
   * emails" mode — it's MYSELF / DOMAIN / ANYONE / ANYONE_ANONYMOUS only.
   * Hence this server-side check. Keep `webapp.access: ANYONE` so the URL
   * is reachable for both partners (any signed-in Google user can hit it),
   * then this list narrows actual access.
   *
   * Lowercase. Comparison is case-insensitive (we normalize at check time).
   */
  ALLOWED_EMAILS: [
    'user1@example.com',
    'user2@example.com',
  ],

  /** Display alias map: email → human label (used by UI; not stored in Sheet). */
  EMAIL_ALIASES: {
    'user2@example.com': 'Юрій',
    'user1@example.com': 'Марічка',
  },

  /** NBU (National Bank of Ukraine) API — live source for UAH→EUR conversion. */
  NBU_RATE_URL: 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange',
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

// CommonJS export for local Node test runner. Apps Script: no-op.
// eslint-disable-next-line no-undef
if (typeof module !== 'undefined') module.exports = { Config };
