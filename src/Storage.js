/**
 * Storage: CRUD over the Google Sheet.
 *
 * Conventions:
 *   - All multi-row writes are wrapped in LockService.getScriptLock() to
 *     guard against concurrent appends from two users simultaneously.
 *     (Document-scoped LockService.getDocumentLock() returns null for
 *     standalone web app scripts; only ScriptLock works here.)
 *   - Column lookup is by header name, not by position. Adding a new column
 *     at the end of a sheet does not break existing code.
 *   - Domain.validate*() runs before every write. Money is already rounded
 *     by the time it reaches Storage (via Domain factories or applyPatch helpers).
 *
 * Schema reference: docs/data-model.md
 */

/* exported Storage */
const Storage = {

  // ============================================================
  // Internal helpers
  // ============================================================

  /** @type {?Object<string, GoogleAppsScript.Spreadsheet.Sheet>} */
  _sheetCache: null,

  /** @type {?Object<string, Object<string, number>>} */
  _headerIndexCache: null,

  /** Open Sheet by ID and cache the handle. */
  _getSheet(name) {
    if (!Storage._sheetCache) Storage._sheetCache = {};
    if (!Storage._sheetCache[name]) {
      const ss = SpreadsheetApp.openById(Config.SHEET_ID);
      const sheet = ss.getSheetByName(name);
      if (!sheet) {
        throw new Error(
          `Sheet tab "${name}" not found in spreadsheet ${Config.SHEET_ID}. ` +
          `Check the tab name matches Config.SHEETS.* exactly.`
        );
      }
      Storage._sheetCache[name] = sheet;
    }
    return Storage._sheetCache[name];
  },

  /**
   * Read header row → map { headerName: columnIndex0Based }. Cached per execution.
   * @returns {Record<string, number>}
   */
  _getHeaderIndex(sheetName) {
    if (!Storage._headerIndexCache) Storage._headerIndexCache = {};
    if (Storage._headerIndexCache[sheetName]) return Storage._headerIndexCache[sheetName];

    const sheet = Storage._getSheet(sheetName);
    const lastCol = sheet.getLastColumn();
    if (lastCol === 0) {
      throw new Error(`Sheet "${sheetName}" is empty (no header row). Did you paste the headers from setup.md?`);
    }
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    /** @type {Record<string, number>} */
    const map = {};
    headers.forEach((h, i) => {
      const key = String(h).trim();
      if (key) map[key] = i;
    });
    Storage._headerIndexCache[sheetName] = map;
    return map;
  },

  /**
   * Convert an entity object to an array, ordered by sheet column position.
   * @returns {any[]}
   */
  _objectToRow(obj, headerIndex) {
    const cols = Object.keys(headerIndex).length;
    const row = new Array(cols).fill('');
    for (const [key, idx] of Object.entries(headerIndex)) {
      const v = obj[key];
      row[idx] = (v === undefined || v === null) ? '' : v;
    }
    return row;
  },

  /**
   * Convert a row array to an entity object using the header index.
   * @returns {any}
   */
  _rowToObject(row, headerIndex) {
    /** @type {Record<string, any>} */
    const obj = {};
    for (const [key, idx] of Object.entries(headerIndex)) {
      const v = row[idx];
      obj[key] = (v === '' ? null : v);
    }
    return obj;
  },

  /** Run fn while holding the document lock. Used for any multi-row write. */
  _withLock(fn) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(Config.LOCK_TIMEOUT_MS)) {
      throw new Error(
        `Could not acquire document lock within ${Config.LOCK_TIMEOUT_MS}ms. ` +
        'Another write is in progress.'
      );
    }
    try {
      return fn();
    } finally {
      lock.releaseLock();
    }
  },

  /** Find row index (1-based, sheet coordinates) where ID column matches. Returns -1 if not found. */
  _findRowById(sheetName, id) {
    const sheet = Storage._getSheet(sheetName);
    const headerIndex = Storage._getHeaderIndex(sheetName);
    if (!('id' in headerIndex)) {
      throw new Error(`Sheet "${sheetName}" has no "id" column.`);
    }
    const idCol = headerIndex.id + 1;
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return -1;
    const ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (ids[i][0] === id) return i + 2;
    }
    return -1;
  },

  /** Reset caches. Call after schema changes (rare). */
  resetCaches() {
    Storage._sheetCache = null;
    Storage._headerIndexCache = null;
  },

  // ============================================================
  // Receipts
  // ============================================================

  /**
   * Append a fully-formed Receipt to the Receipts sheet.
   * @param {Receipt} receipt
   * @returns {string} receipt.id
   */
  appendReceipt(receipt) {
    Domain.validateReceipt(receipt);
    return Storage._withLock(() => {
      const sheet = Storage._getSheet(Config.SHEETS.RECEIPTS);
      const headerIndex = Storage._getHeaderIndex(Config.SHEETS.RECEIPTS);
      sheet.appendRow(Storage._objectToRow(receipt, headerIndex));
      return receipt.id;
    });
  },

  /** @returns {?Receipt} */
  getReceipt(id) {
    const sheet = Storage._getSheet(Config.SHEETS.RECEIPTS);
    const headerIndex = Storage._getHeaderIndex(Config.SHEETS.RECEIPTS);
    const rowNum = Storage._findRowById(Config.SHEETS.RECEIPTS, id);
    if (rowNum === -1) return null;
    const row = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn()).getValues()[0];
    return Storage._rowToObject(row, headerIndex);
  },

  /**
   * Update a Receipt by ID. Pass the full updated Receipt object (use
   * Domain.applyReceiptPatch to build it).
   * @param {Receipt} receipt
   */
  updateReceipt(receipt) {
    Domain.validateReceipt(receipt);
    return Storage._withLock(() => {
      const sheet = Storage._getSheet(Config.SHEETS.RECEIPTS);
      const headerIndex = Storage._getHeaderIndex(Config.SHEETS.RECEIPTS);
      const rowNum = Storage._findRowById(Config.SHEETS.RECEIPTS, receipt.id);
      if (rowNum === -1) throw new Error(`Receipt not found: ${receipt.id}`);
      sheet.getRange(rowNum, 1, 1, sheet.getLastColumn())
        .setValues([Storage._objectToRow(receipt, headerIndex)]);
    });
  },

  /** Hard-delete a Receipt and all its Items by receipt_id. */
  deleteReceipt(id) {
    return Storage._withLock(() => {
      const rSheet = Storage._getSheet(Config.SHEETS.RECEIPTS);
      const rRow = Storage._findRowById(Config.SHEETS.RECEIPTS, id);
      if (rRow === -1) throw new Error(`Receipt not found: ${id}`);
      rSheet.deleteRow(rRow);

      // Delete all items with this receipt_id (iterate from bottom to keep indices stable)
      const iSheet = Storage._getSheet(Config.SHEETS.ITEMS);
      const iHeaderIndex = Storage._getHeaderIndex(Config.SHEETS.ITEMS);
      const iLastRow = iSheet.getLastRow();
      if (iLastRow >= 2) {
        const data = iSheet.getRange(2, 1, iLastRow - 1, iSheet.getLastColumn()).getValues();
        for (let i = data.length - 1; i >= 0; i--) {
          if (data[i][iHeaderIndex.receipt_id] === id) {
            iSheet.deleteRow(i + 2);
          }
        }
      }
    });
  },

  /** Return last N receipts ordered by date desc, created_at desc. */
  listRecent(limit) {
    const sheet = Storage._getSheet(Config.SHEETS.RECEIPTS);
    const headerIndex = Storage._getHeaderIndex(Config.SHEETS.RECEIPTS);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    const receipts = data.map(row => Storage._rowToObject(row, headerIndex));
    receipts.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.created_at < b.created_at ? 1 : -1;
    });
    return receipts.slice(0, limit);
  },

  // ============================================================
  // Items
  // ============================================================

  /**
   * Append multiple Items in one locked operation. All items must have the same
   * receipt_id (enforced) — they belong to one Receipt.
   * @param {Item[]} items
   */
  appendItems(items) {
    if (!items || items.length === 0) return [];
    items.forEach(Domain.validateItem);
    const receiptId = items[0].receipt_id;
    if (!items.every(it => it.receipt_id === receiptId)) {
      throw new Error('appendItems: all items must share the same receipt_id');
    }
    return Storage._withLock(() => {
      const sheet = Storage._getSheet(Config.SHEETS.ITEMS);
      const headerIndex = Storage._getHeaderIndex(Config.SHEETS.ITEMS);
      const rows = items.map(it => Storage._objectToRow(it, headerIndex));
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
      return items.map(it => it.id);
    });
  },

  /** @returns {Item[]} */
  getItemsByReceipt(receiptId) {
    const sheet = Storage._getSheet(Config.SHEETS.ITEMS);
    const headerIndex = Storage._getHeaderIndex(Config.SHEETS.ITEMS);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    return data
      .filter(row => row[headerIndex.receipt_id] === receiptId)
      .map(row => Storage._rowToObject(row, headerIndex));
  },

  updateItem(item) {
    Domain.validateItem(item);
    return Storage._withLock(() => {
      const sheet = Storage._getSheet(Config.SHEETS.ITEMS);
      const headerIndex = Storage._getHeaderIndex(Config.SHEETS.ITEMS);
      const rowNum = Storage._findRowById(Config.SHEETS.ITEMS, item.id);
      if (rowNum === -1) throw new Error(`Item not found: ${item.id}`);
      sheet.getRange(rowNum, 1, 1, sheet.getLastColumn())
        .setValues([Storage._objectToRow(item, headerIndex)]);
    });
  },

  deleteItem(id) {
    return Storage._withLock(() => {
      const sheet = Storage._getSheet(Config.SHEETS.ITEMS);
      const rowNum = Storage._findRowById(Config.SHEETS.ITEMS, id);
      if (rowNum === -1) throw new Error(`Item not found: ${id}`);
      sheet.deleteRow(rowNum);
    });
  },

  // ============================================================
  // Products
  // ============================================================

  appendProduct(product) {
    Domain.validateProduct(product);
    return Storage._withLock(() => {
      const sheet = Storage._getSheet(Config.SHEETS.PRODUCTS);
      const headerIndex = Storage._getHeaderIndex(Config.SHEETS.PRODUCTS);
      sheet.appendRow(Storage._objectToRow(product, headerIndex));
      return product.id;
    });
  },

  /** @returns {?Product} */
  getProduct(id) {
    const sheet = Storage._getSheet(Config.SHEETS.PRODUCTS);
    const headerIndex = Storage._getHeaderIndex(Config.SHEETS.PRODUCTS);
    const rowNum = Storage._findRowById(Config.SHEETS.PRODUCTS, id);
    if (rowNum === -1) return null;
    const row = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn()).getValues()[0];
    return Storage._rowToObject(row, headerIndex);
  },

  /** Find product by exact name match. Case-sensitive. @returns {?Product} */
  findProductByName(name) {
    const sheet = Storage._getSheet(Config.SHEETS.PRODUCTS);
    const headerIndex = Storage._getHeaderIndex(Config.SHEETS.PRODUCTS);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return null;
    const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    for (const row of data) {
      if (row[headerIndex.name] === name) return Storage._rowToObject(row, headerIndex);
    }
    return null;
  },

  /** @returns {Product[]} */
  listProducts() {
    const sheet = Storage._getSheet(Config.SHEETS.PRODUCTS);
    const headerIndex = Storage._getHeaderIndex(Config.SHEETS.PRODUCTS);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    return data.map(row => Storage._rowToObject(row, headerIndex));
  },

  updateProduct(product) {
    Domain.validateProduct(product);
    return Storage._withLock(() => {
      const sheet = Storage._getSheet(Config.SHEETS.PRODUCTS);
      const headerIndex = Storage._getHeaderIndex(Config.SHEETS.PRODUCTS);
      const rowNum = Storage._findRowById(Config.SHEETS.PRODUCTS, product.id);
      if (rowNum === -1) throw new Error(`Product not found: ${product.id}`);
      sheet.getRange(rowNum, 1, 1, sheet.getLastColumn())
        .setValues([Storage._objectToRow(product, headerIndex)]);
    });
  },

  // ============================================================
  // Categories
  // ============================================================

  /** @returns {Array<{name:string, group:string}>} */
  getCategories() {
    const sheet = Storage._getSheet(Config.SHEETS.CATEGORIES);
    const headerIndex = Storage._getHeaderIndex(Config.SHEETS.CATEGORIES);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    return data
      .filter(row => row[headerIndex.name])
      .map(row => Storage._rowToObject(row, headerIndex));
  },

  // ============================================================
  // FxRates  (used internally by Fx.js; exposed for completeness)
  // ============================================================

  /** Append rate rows in a single locked operation, skipping (date,currency) duplicates. */
  appendFxRates(rates) {
    if (!rates || rates.length === 0) return 0;
    return Storage._withLock(() => {
      const sheet = Storage._getSheet(Config.SHEETS.FX_RATES);
      const headerIndex = Storage._getHeaderIndex(Config.SHEETS.FX_RATES);
      const lastRow = sheet.getLastRow();
      const existing = new Set();
      if (lastRow >= 2) {
        const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
        for (const row of data) {
          existing.add(`${row[headerIndex.date]}|${row[headerIndex.currency]}`);
        }
      }
      const fresh = rates.filter(r => !existing.has(`${r.date}|${r.currency}`));
      if (fresh.length === 0) return 0;
      const rows = fresh.map(r => Storage._objectToRow(r, headerIndex));
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
      return fresh.length;
    });
  },

  /** Read all rate rows. Used by Fx.getRate. */
  listFxRates() {
    const sheet = Storage._getSheet(Config.SHEETS.FX_RATES);
    const headerIndex = Storage._getHeaderIndex(Config.SHEETS.FX_RATES);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    return data
      .filter(row => row[headerIndex.date] && row[headerIndex.currency])
      .map(row => Storage._rowToObject(row, headerIndex));
  },
};

// CommonJS export for local Node test runner. Apps Script: no-op.
// eslint-disable-next-line no-undef
if (typeof module !== 'undefined') module.exports = { Storage };
