/**
 * Domain: types, validators, factories, ULID generator, formatters.
 *
 * Authoritative business logic. Storage and Web layers are not allowed to
 * round money, parse `consumed_by`, or generate IDs themselves — they go
 * through this module. Single source of truth for invariants.
 *
 * Schema reference: docs/data-model.md
 */

// ============================================================
// JSDoc type definitions
// ============================================================

/**
 * @typedef {Object} Receipt
 * @property {string}  id
 * @property {string}  date          - 'YYYY-MM-DD'
 * @property {string}  store
 * @property {string}  currency      - ISO 4217 (e.g. 'EUR', 'UAH')
 * @property {number}  total_orig    - rounded to MONEY_DECIMALS
 * @property {number}  fx_rate_eur   - rounded to FX_RATE_DECIMALS; 1.0 for EUR
 * @property {number}  total_eur     - rounded to MONEY_DECIMALS
 * @property {string}  paid_by       - email
 * @property {?string} photo_url
 * @property {'photo'|'manual'|'edit'} source
 * @property {?string} raw_ocr_json  - compact JSON of items array; ≤45000 chars
 * @property {?string} note
 * @property {string}  created_at    - ISO 8601 with offset
 * @property {string}  updated_at    - ISO 8601 with offset
 */

/**
 * @typedef {Object} Item
 * @property {string}  id
 * @property {string}  receipt_id
 * @property {?string} product_id     - nullable for commodity / one-off
 * @property {string}  product_name   - snapshot at purchase time
 * @property {string}  category
 * @property {number}  qty
 * @property {number}  unit_price_orig
 * @property {number}  total_orig
 * @property {number}  total_eur
 * @property {string}  consumed_by    - 'his' | 'hers' | 'shared' | 'custom:N/M'
 * @property {?string} note
 * @property {number}  wasted_qty     - default 0; ≤ qty
 * @property {string}  created_at
 * @property {string}  updated_at
 */

/**
 * @typedef {Object} Product
 * @property {string}  id
 * @property {string}  name
 * @property {string}  category
 * @property {?string} unit           - 'pcs'|'g'|'kg'|'ml'|'l'
 * @property {?number} unit_size
 * @property {?string} notes
 * @property {string}  created_at
 * @property {string}  updated_at
 */

/**
 * @typedef {Object} ParsedItem
 * @property {string} product_name           - raw text as on the receipt
 * @property {number} qty
 * @property {number} unit_price_orig
 * @property {?string} category_suggestion   - one of Categories.name; null if uncertain
 */

/**
 * @typedef {Object} ParsedReceipt
 * @property {?string} store          - best-effort store name; null if illegible
 * @property {?string} date           - 'YYYY-MM-DD'; null if illegible
 * @property {string}  currency       - ISO 4217; default 'EUR'
 * @property {?number} total_orig     - sanity-check total; nullable
 * @property {ParsedItem[]} items
 */

// ============================================================
// Domain module
// ============================================================

/* exported Domain */
const Domain = {
  // ---------- ULID generator ----------

  /**
   * Generate a Crockford-Base32 ULID: 10 chars timestamp + 16 chars randomness.
   * Time-sortable. Uniqueness is probabilistic (Math.random) — sufficient for
   * a 2-user app generating <1000 IDs/day.
   *
   * @returns {string} 26-char ULID
   */
  ulid() {
    const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

    let timeStr = '';
    let t = Date.now();
    for (let i = 0; i < 10; i++) {
      timeStr = ALPHABET[t % 32] + timeStr;
      t = Math.floor(t / 32);
    }

    let randStr = '';
    for (let i = 0; i < 16; i++) {
      randStr += ALPHABET[Math.floor(Math.random() * 32)];
    }

    return timeStr + randStr;
  },

  // ---------- Time helpers ----------

  /** ISO 8601 timestamp in configured timezone, e.g. '2026-05-04T14:30:00+02:00'. */
  nowIso() {
    return Utilities.formatDate(new Date(), Config.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
  },

  /** 'YYYY-MM-DD' for today in configured timezone. */
  todayIso() {
    return Utilities.formatDate(new Date(), Config.TIMEZONE, 'yyyy-MM-dd');
  },

  // ---------- Number rounding (rounding-on-write contract) ----------

  roundMoney(value) {
    const factor = Math.pow(10, Config.MONEY_DECIMALS);
    return Math.round(value * factor) / factor;
  },

  roundQty(value) {
    const factor = Math.pow(10, Config.QTY_DECIMALS);
    return Math.round(value * factor) / factor;
  },

  roundFxRate(value) {
    const factor = Math.pow(10, Config.FX_RATE_DECIMALS);
    return Math.round(value * factor) / factor;
  },

  // ---------- consumed_by parser ----------

  /**
   * Parse `consumed_by` syntax.
   *   'his'   → { type: 'his' }
   *   'hers'  → { type: 'hers' }
   *   'shared'→ { type: 'shared' }
   *   'custom:30/70' → { type: 'custom', hisShare: 30, hersShare: 70 }
   * Custom shares must be non-negative integers summing to 100.
   *
   * @param {string} value
   * @returns {{type:string, hisShare?:number, hersShare?:number}}
   */
  parseConsumedBy(value) {
    if (value === 'his' || value === 'hers' || value === 'shared') {
      return { type: value };
    }
    const m = /^custom:(\d+)\/(\d+)$/.exec(value);
    if (m) {
      const hisShare = parseInt(m[1], 10);
      const hersShare = parseInt(m[2], 10);
      if (hisShare + hersShare !== 100) {
        throw new Error(
          `Invalid consumed_by "${value}": shares must sum to 100, got ${hisShare + hersShare}`
        );
      }
      return { type: 'custom', hisShare, hersShare };
    }
    throw new Error(
      `Invalid consumed_by syntax: "${value}". ` +
      'Expected: his | hers | shared | custom:N/M (N+M=100)'
    );
  },

  // ---------- Validators ----------

  validateReceipt(r) {
    const errs = [];
    if (!r.id) errs.push('id is required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) errs.push(`date must be YYYY-MM-DD, got "${r.date}"`);
    if (!r.store) errs.push('store is required');
    if (!/^[A-Z]{3}$/.test(r.currency)) errs.push(`currency must be ISO 4217, got "${r.currency}"`);
    if (typeof r.total_orig !== 'number' || isNaN(r.total_orig)) errs.push('total_orig must be number');
    if (typeof r.fx_rate_eur !== 'number' || isNaN(r.fx_rate_eur)) errs.push('fx_rate_eur must be number');
    if (typeof r.total_eur !== 'number' || isNaN(r.total_eur)) errs.push('total_eur must be number');
    if (!r.paid_by || !r.paid_by.includes('@')) errs.push(`paid_by must be email, got "${r.paid_by}"`);
    if (!['photo', 'manual', 'edit'].includes(r.source)) errs.push(`source must be photo/manual/edit, got "${r.source}"`);
    if (r.raw_ocr_json !== null && r.raw_ocr_json !== undefined && r.raw_ocr_json.length > 45000) {
      errs.push(`raw_ocr_json exceeds 45000 chars (${r.raw_ocr_json.length})`);
    }
    if (!r.created_at) errs.push('created_at is required');
    if (!r.updated_at) errs.push('updated_at is required');
    if (errs.length) throw new Error(`Invalid Receipt: ${errs.join('; ')}`);
  },

  validateItem(it) {
    const errs = [];
    if (!it.id) errs.push('id is required');
    if (!it.receipt_id) errs.push('receipt_id is required');
    if (!it.product_name) errs.push('product_name is required');
    if (!it.category) errs.push('category is required');
    if (typeof it.qty !== 'number' || it.qty <= 0) errs.push('qty must be positive number');
    if (typeof it.unit_price_orig !== 'number') errs.push('unit_price_orig must be number');
    if (typeof it.total_orig !== 'number') errs.push('total_orig must be number');
    if (typeof it.total_eur !== 'number') errs.push('total_eur must be number');
    try { Domain.parseConsumedBy(it.consumed_by); } catch (e) { errs.push(e.message); }
    if (typeof it.wasted_qty !== 'number' || it.wasted_qty < 0) {
      errs.push('wasted_qty must be non-negative number');
    }
    if (typeof it.qty === 'number' && typeof it.wasted_qty === 'number' && it.wasted_qty > it.qty) {
      errs.push(`wasted_qty (${it.wasted_qty}) cannot exceed qty (${it.qty})`);
    }
    if (errs.length) throw new Error(`Invalid Item: ${errs.join('; ')}`);
  },

  validateProduct(p) {
    const errs = [];
    if (!p.id) errs.push('id is required');
    if (!p.name) errs.push('name is required');
    if (!p.category) errs.push('category is required');
    if (p.unit && !['pcs', 'g', 'kg', 'ml', 'l'].includes(p.unit)) {
      errs.push(`unit must be one of pcs/g/kg/ml/l, got "${p.unit}"`);
    }
    if (errs.length) throw new Error(`Invalid Product: ${errs.join('; ')}`);
  },

  /**
   * Soft validator for AI output. Allows nullable store/date/total since AI
   * may legitimately fail to read those off a noisy receipt — UI lets the
   * user fill them in. Hard requirements: ISO-4217 currency, items array,
   * each item has product_name + numeric qty/unit_price_orig.
   * @param {ParsedReceipt} parsed
   */
  validateParsedReceipt(parsed) {
    const errs = [];
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid ParsedReceipt: expected object');
    }
    if (!/^[A-Z]{3}$/.test(parsed.currency)) {
      errs.push(`currency must be ISO 4217, got "${parsed.currency}"`);
    }
    if (parsed.date !== null && parsed.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) {
      errs.push(`date must be YYYY-MM-DD or null, got "${parsed.date}"`);
    }
    if (parsed.total_orig !== null && parsed.total_orig !== undefined
        && (typeof parsed.total_orig !== 'number' || isNaN(parsed.total_orig))) {
      errs.push('total_orig must be number or null');
    }
    if (!Array.isArray(parsed.items)) {
      errs.push('items must be array');
    } else {
      parsed.items.forEach((it, i) => {
        if (!it || typeof it !== 'object') { errs.push(`items[${i}] not object`); return; }
        if (!it.product_name || typeof it.product_name !== 'string') errs.push(`items[${i}].product_name required string`);
        if (typeof it.qty !== 'number' || isNaN(it.qty) || it.qty <= 0) errs.push(`items[${i}].qty must be positive number`);
        if (typeof it.unit_price_orig !== 'number' || isNaN(it.unit_price_orig)) errs.push(`items[${i}].unit_price_orig must be number`);
      });
    }
    if (errs.length) throw new Error(`Invalid ParsedReceipt: ${errs.join('; ')}`);
  },

  // ---------- Factories ----------

  /**
   * Build a valid Receipt from raw input. Generates id, fills timestamps,
   * rounds money, computes total_eur, validates. Throws on invalid input.
   *
   * @param {Object} input
   * @param {string} input.date
   * @param {string} input.store
   * @param {string} input.currency
   * @param {number} input.total_orig
   * @param {number} input.fx_rate_eur
   * @param {string} input.paid_by
   * @param {'photo'|'manual'|'edit'} input.source
   * @param {?string} [input.photo_url]
   * @param {?string} [input.raw_ocr_json]
   * @param {?string} [input.note]
   * @returns {Receipt}
   */
  makeReceipt(input) {
    const total_orig = Domain.roundMoney(input.total_orig);
    const fx_rate_eur = Domain.roundFxRate(input.fx_rate_eur);
    const total_eur = Domain.roundMoney(total_orig * fx_rate_eur);
    const now = Domain.nowIso();
    const r = {
      id: Domain.ulid(),
      date: input.date,
      store: input.store,
      currency: input.currency,
      total_orig,
      fx_rate_eur,
      total_eur,
      paid_by: input.paid_by,
      photo_url: input.photo_url || null,
      source: input.source,
      raw_ocr_json: input.raw_ocr_json || null,
      note: input.note || null,
      created_at: now,
      updated_at: now,
    };
    Domain.validateReceipt(r);
    return r;
  },

  /**
   * @param {Object} input
   * @param {string} input.receipt_id
   * @param {?string} [input.product_id]
   * @param {string} input.product_name
   * @param {string} input.category
   * @param {number} input.qty
   * @param {number} input.unit_price_orig
   * @param {number} input.fx_rate_eur  - inherited from parent receipt
   * @param {string} input.consumed_by
   * @param {?string} [input.note]
   * @param {number} [input.wasted_qty]
   * @returns {Item}
   */
  makeItem(input) {
    const qty = Domain.roundQty(input.qty);
    const unit_price_orig = Domain.roundMoney(input.unit_price_orig);
    const total_orig = Domain.roundMoney(qty * unit_price_orig);
    const total_eur = Domain.roundMoney(total_orig * input.fx_rate_eur);
    const wasted_qty = Domain.roundQty(input.wasted_qty || 0);
    const now = Domain.nowIso();
    const it = {
      id: Domain.ulid(),
      receipt_id: input.receipt_id,
      product_id: input.product_id || null,
      product_name: input.product_name,
      category: input.category,
      qty,
      unit_price_orig,
      total_orig,
      total_eur,
      consumed_by: input.consumed_by,
      note: input.note || null,
      wasted_qty,
      created_at: now,
      updated_at: now,
    };
    Domain.validateItem(it);
    return it;
  },

  /**
   * @param {Object} input
   * @param {string} input.name
   * @param {string} input.category
   * @param {?string} [input.unit]
   * @param {?number} [input.unit_size]
   * @param {?string} [input.notes]
   * @returns {Product}
   */
  makeProduct(input) {
    const now = Domain.nowIso();
    const p = {
      id: Domain.ulid(),
      name: input.name,
      category: input.category,
      unit: input.unit || null,
      unit_size: (typeof input.unit_size === 'number') ? input.unit_size : null,
      notes: input.notes || null,
      created_at: now,
      updated_at: now,
    };
    Domain.validateProduct(p);
    return p;
  },

  // ---------- Patch helpers (for UPDATE) ----------

  /**
   * Apply a partial patch to an existing Receipt. Recomputes total_eur if money
   * fields changed. Bumps updated_at. Validates result.
   */
  applyReceiptPatch(existing, patch) {
    const merged = Object.assign({}, existing, patch);
    if (patch.total_orig !== undefined) merged.total_orig = Domain.roundMoney(patch.total_orig);
    if (patch.fx_rate_eur !== undefined) merged.fx_rate_eur = Domain.roundFxRate(patch.fx_rate_eur);
    merged.total_eur = Domain.roundMoney(merged.total_orig * merged.fx_rate_eur);
    merged.updated_at = Domain.nowIso();
    Domain.validateReceipt(merged);
    return merged;
  },

  applyItemPatch(existing, patch, parentFxRate) {
    const merged = Object.assign({}, existing, patch);
    if (patch.qty !== undefined) merged.qty = Domain.roundQty(patch.qty);
    if (patch.unit_price_orig !== undefined) merged.unit_price_orig = Domain.roundMoney(patch.unit_price_orig);
    if (patch.wasted_qty !== undefined) merged.wasted_qty = Domain.roundQty(patch.wasted_qty);
    merged.total_orig = Domain.roundMoney(merged.qty * merged.unit_price_orig);
    merged.total_eur = Domain.roundMoney(merged.total_orig * parentFxRate);
    merged.updated_at = Domain.nowIso();
    Domain.validateItem(merged);
    return merged;
  },
};

// CommonJS export for local Node test runner. Apps Script: `module` is
// undefined, the typeof guard short-circuits, this line is a no-op.
// eslint-disable-next-line no-undef
if (typeof module !== 'undefined') module.exports = { Domain };
