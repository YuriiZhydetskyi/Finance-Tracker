/**
 * Web: doGet (page routing) + JSON endpoints called via google.script.run.
 *
 * All endpoints are synchronous on the server side — UrlFetchApp blocks.
 * The Promise wrapper lives only on the client (src/ui/shared/webapp.html
 * defines runServer(fnName, args) → Promise). See ADR-0003 changelog.
 *
 * Storage.appendReceipt and Storage.appendItems each acquire their own
 * ScriptLock independently. There is no cross-call atomicity for save/update;
 * a torn write leaves a Receipt without Items, which the UI handles by
 * showing the receipt with an empty items list. If transactional multi-row
 * writes become a real problem, introduce Storage.transaction(fn) — until
 * then, YAGNI.
 */

/* exported Web, doGet, parseReceipt, saveReceipt, getReceipt,
            updateReceipt, deleteReceipt, listRecent, whoAmI, include,
            getCategories, listProducts */
const Web = {

  PAGES: ['index', 'photo', 'manual', 'edit', 'recent'],

  /** Apps Script web-app entry point. */
  doGet(e) {
    const email = Web._currentUserEmail();
    if (!Web._isAuthorized(email)) {
      return Web._deniedPage(email);
    }

    const params = (e && e.parameter) || {};
    const requested = params.page || 'index';
    const page = Web.PAGES.includes(requested) ? requested : 'index';

    // Apps Script renders HTML inside a googleusercontent.com iframe; relative
    // links inside that iframe resolve against the iframe origin, not the
    // public /exec URL on script.google.com. We pass the script URL and query
    // params into every template so <base href> + JS navigateTo can drive the
    // top window correctly.
    Web._scriptUrl = '';
    try { Web._scriptUrl = ScriptApp.getService().getUrl() || ''; } catch (_e) { /* tests */ }
    Web._queryParams = params;

    const tpl = HtmlService.createTemplateFromFile(`ui/${page}`);
    tpl.scriptUrl = Web._scriptUrl;
    tpl.queryParams = Web._queryParams;
    return tpl.evaluate()
      .setTitle('Finance Tracker')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  },

  /**
   * Used inside HTML templates: <?!= include('shared/webapp') ?>
   *
   * Returns the included file's RAW content (no scriptlet evaluation).
   * Shared files (shared/styles, shared/webapp, shared/ItemsTable, shared/Summary)
   * are scriptlet-free by contract. Per-page scriptlets like <?= scriptUrl ?>
   * live directly in the page templates' <head>, evaluated natively when
   * Web.doGet calls tpl.evaluate(). We avoid recursive template evaluation
   * because Apps Script's HtmlTemplate is a Java-backed proxy whose
   * evaluate() method becomes unreachable when custom properties are set
   * on it from inside another template's evaluation context.
   */
  include(name) {
    return HtmlService.createHtmlOutputFromFile(`ui/${name}`).getContent();
  },

  // ============================================================
  // JSON endpoints (google.script.run targets)
  // ============================================================

  /**
   * Run AI parsing on a base64-encoded image.
   * @param {string} base64 - JPEG/PNG bytes as base64 (no data URL prefix).
   * @param {string} [mimeType] - reserved for future provider switching;
   *   Gemini currently hardcodes image/jpeg in inline_data.
   * @returns {ParsedReceipt}
   */
  // eslint-disable-next-line no-unused-vars
  parseReceipt(base64, mimeType) {
    Web._assertAuthorized();
    const ctx = {
      categories: Storage.getCategories().map(c => c.name),
      products:   Storage.listProducts(),
    };
    return AiClient.parseReceipt(base64, ctx);
  },

  /**
   * Insert a new Receipt + its Items.
   * @param {Object} input - raw receipt fields (no id, no fx_rate, no totals).
   *   {date, store, currency, total_orig, paid_by, source, note?, raw_ocr_json?}
   * @param {Array} items - raw item fields, one per line.
   *   {product_id?, product_name, category, qty, unit_price_orig, consumed_by, note?, wasted_qty?}
   * @param {?string} [photoBase64] - optional photo bytes to upload to Drive.
   * @param {?string} [photoMimeType]
   * @returns {{receipt_id: string, items_count: number}}
   */
  saveReceipt(input, items, photoBase64, photoMimeType) {
    Web._assertAuthorized();
    if (!input) throw new Error('saveReceipt: input is required');
    if (!Array.isArray(items)) throw new Error('saveReceipt: items must be an array');

    const fxRate = Fx.getRateLive(input.currency, input.date);
    const photoUrl = photoBase64
      ? Web._savePhotoToDrive(photoBase64, photoMimeType, input.date)
      : null;

    const receipt = Domain.makeReceipt(Object.assign({}, input, {
      fx_rate_eur: fxRate,
      photo_url: photoUrl,
    }));
    const itemRecords = items.map(it => Domain.makeItem(Object.assign({}, it, {
      receipt_id: receipt.id,
      fx_rate_eur: fxRate,
    })));

    Storage.appendReceipt(receipt);
    if (itemRecords.length) Storage.appendItems(itemRecords);

    return { receipt_id: receipt.id, items_count: itemRecords.length };
  },

  /**
   * Update an existing Receipt and replace its Items.
   *
   * Items are replaced wholesale (delete-all-then-append) rather than diffed.
   * For a typical 5–50 item receipt the round-trip is well under a second
   * and the code is dramatically simpler than a per-item id/patch resolver.
   *
   * @param {string} id - receipt ULID.
   * @param {Object} patch - subset of receipt fields to update.
   * @param {Array} [items] - if provided, full new items list; if omitted, existing items are kept.
   * @returns {{receipt_id: string}}
   */
  updateReceipt(id, patch, items) {
    Web._assertAuthorized();
    if (!id) throw new Error('updateReceipt: id is required');
    const existing = Storage.getReceipt(id);
    if (!existing) throw new Error(`Receipt not found: ${id}`);

    const effectivePatch = Object.assign({}, patch || {});
    let fxRate = existing.fx_rate_eur;
    const currencyChanged = effectivePatch.currency && effectivePatch.currency !== existing.currency;
    const dateChanged = effectivePatch.date && effectivePatch.date !== existing.date;
    if (currencyChanged || dateChanged) {
      fxRate = Fx.getRateLive(
        effectivePatch.currency || existing.currency,
        effectivePatch.date || existing.date
      );
      effectivePatch.fx_rate_eur = fxRate;
    }
    effectivePatch.source = 'edit';

    const merged = Domain.applyReceiptPatch(existing, effectivePatch);
    Storage.updateReceipt(merged);

    if (Array.isArray(items)) {
      const existingItems = Storage.getItemsByReceipt(id);
      existingItems.forEach(it => Storage.deleteItem(it.id));
      if (items.length) {
        const newItems = items.map(it => Domain.makeItem(Object.assign({}, it, {
          receipt_id: id,
          fx_rate_eur: fxRate,
        })));
        Storage.appendItems(newItems);
      }
    }

    return { receipt_id: id };
  },

  /**
   * Fetch a Receipt and its Items by ID.
   * @param {string} id
   * @returns {?{receipt: Receipt, items: Item[]}}
   */
  getReceipt(id) {
    Web._assertAuthorized();
    const receipt = Storage.getReceipt(id);
    if (!receipt) return null;
    const items = Storage.getItemsByReceipt(id);
    return { receipt, items };
  },

  /** Hard-delete Receipt; Storage cascades to Items. */
  deleteReceipt(id) {
    Web._assertAuthorized();
    if (!id) throw new Error('deleteReceipt: id is required');
    Storage.deleteReceipt(id);
    return { ok: true };
  },

  /** Last N receipts ordered by date desc. */
  listRecent(limit) {
    Web._assertAuthorized();
    return Storage.listRecent(limit || 30);
  },

  /** Category names for UI dropdowns. */
  getCategories() {
    Web._assertAuthorized();
    return Storage.getCategories().map(c => c.name);
  },

  /** Products for the autocomplete datalist (Phase 3 UI-side matching). */
  listProducts() {
    Web._assertAuthorized();
    return Storage.listProducts();
  },

  /**
   * Server-side identity for the UI. Reads getEffectiveUser (which works for
   * personal Gmail when userinfo.email scope is granted, unlike the older
   * getActiveUser() which can return ""). The UI keeps a localStorage
   * fallback as belt-and-braces.
   */
  whoAmI() {
    Web._assertAuthorized();
    return Web._currentUserEmail();
  },

  // ============================================================
  // Internal helpers
  // ============================================================

  /** Read the accessing user's email. getEffectiveUser is reliable for
   *  personal Gmail when userinfo.email scope is granted; getActiveUser
   *  can return "" in cross-domain scenarios. */
  _currentUserEmail() {
    try {
      return (Session.getEffectiveUser().getEmail() || '').toLowerCase();
    } catch (_e) {
      return '';
    }
  },

  /** True if `email` is in Config.ALLOWED_EMAILS (case-insensitive). */
  _isAuthorized(email) {
    if (!email) return false;
    const normalized = String(email).toLowerCase();
    return Config.ALLOWED_EMAILS.some(allowed => allowed.toLowerCase() === normalized);
  },

  /** Throws if the accessing user is not in the allowlist. Use from every
   *  google.script.run target — doGet has its own friendly denied page. */
  _assertAuthorized() {
    const email = Web._currentUserEmail();
    if (!Web._isAuthorized(email)) {
      throw new Error(`Access denied for "${email || '(no email)'}"`);
    }
    return email;
  },

  /** Render a friendly access-denied page (HTML, no scriptlets). */
  _deniedPage(email) {
    const safeEmail = (email || '(no email available)').replace(/[<>&]/g, ch =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch])
    );
    return HtmlService.createHtmlOutput(
      `<!DOCTYPE html><html lang="uk"><head>` +
      `<meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>Finance Tracker — доступ обмежено</title>` +
      `<style>body{font:16px -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#1a1a1a;background:#fafafa;padding:24px;max-width:520px;margin:0 auto}h1{font-size:20px}code{background:#eee;padding:2px 6px;border-radius:4px}</style>` +
      `</head><body>` +
      `<h1>🔒 Доступ обмежено</h1>` +
      `<p>Ви увійшли як <code>${safeEmail}</code>, але цей акаунт не у списку дозволених.</p>` +
      `<p>Перевір що ти залогінений у потрібний Google акаунт. Якщо ти власник — додай свій email у <code>Config.ALLOWED_EMAILS</code> і передеплой.</p>` +
      `</body></html>`
    ).setTitle('Finance Tracker — доступ обмежено');
  },

  _savePhotoToDrive(base64, mimeType, dateIso) {
    const folder = DriveApp.getFolderById(Config.DRIVE_FOLDER_ID);
    const bytes = Utilities.base64Decode(base64);
    const filename = `${dateIso}-${Domain.ulid()}.jpg`;
    const blob = Utilities.newBlob(bytes, mimeType || 'image/jpeg', filename);
    const file = folder.createFile(blob);
    return file.getUrl();
  },

};

// ============================================================
// Top-level wrappers (function picker + google.script.run targets)
// ============================================================

function doGet(e)                                  { return Web.doGet(e); }
function include(name)                             { return Web.include(name); }
function parseReceipt(b64, mime)                   { return Web.parseReceipt(b64, mime); }
function saveReceipt(input, items, photo, mime)    { return Web.saveReceipt(input, items, photo, mime); }
function updateReceipt(id, patch, items)           { return Web.updateReceipt(id, patch, items); }
function getReceipt(id)                            { return Web.getReceipt(id); }
function deleteReceipt(id)                         { return Web.deleteReceipt(id); }
function listRecent(limit)                         { return Web.listRecent(limit); }
function getCategories()                           { return Web.getCategories(); }
function listProducts()                            { return Web.listProducts(); }
function whoAmI()                                  { return Web.whoAmI(); }

// CommonJS export for local Node test runner. Apps Script: no-op.
// eslint-disable-next-line no-undef
if (typeof module !== 'undefined') module.exports = { Web };
