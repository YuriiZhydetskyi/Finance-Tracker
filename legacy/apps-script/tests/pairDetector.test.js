/**
 * Unit tests for src/ui/shared/pairDetector.html.
 *
 * The detector lives in an HTML <script> block (so Apps Script can include it
 * verbatim into the page). To exercise it under Node we read the file, strip
 * the surrounding <script> tags, and eval the function in a fresh vm context.
 *
 * See ADR-0012 for the algorithm rationale.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert');

function loadDetector() {
  const html = fs.readFileSync(
    path.resolve(__dirname, '../src/ui/shared/pairDetector.html'),
    'utf8'
  );
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('No <script> block found in pairDetector.html');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(m[1], sandbox);
  return sandbox.detectPairs;
}

const detectPairs = loadDetector();

function pi(product_name, qty, unit_price_orig, category_suggestion) {
  return {
    product_name,
    qty,
    unit_price_orig,
    category_suggestion: category_suggestion || null,
  };
}

// ============================================================
// No-op cases
// ============================================================

test('detectPairs: empty array → empty output', () => {
  const r = detectPairs([]);
  // Note: the function lives in a vm context, so its Array prototype differs
  // from Node's. Compare by structure (length / values), not reference.
  assert.strictEqual(r.items.length, 0);
  assert.strictEqual(r.cancellations.length, 0);
});

test('detectPairs: non-array input → empty output (defensive)', () => {
  for (const bad of [null, undefined]) {
    const r = detectPairs(bad);
    assert.strictEqual(r.items.length, 0);
    assert.strictEqual(r.cancellations.length, 0);
  }
});

test('detectPairs: items without pairs pass through unchanged', () => {
  const a = pi('Bread', 1, 2.50, 'Бакалія');
  const b = pi('Milk', 1, 1.20, 'Молочка');
  const r = detectPairs([a, b]);
  assert.strictEqual(r.items.length, 2);
  assert.strictEqual(r.cancellations.length, 0);
  assert.strictEqual(r.items[0].product_name, 'Bread');
  assert.strictEqual(r.items[0].unit_price_orig, 2.50);
  assert.strictEqual(r.items[1].product_name, 'Milk');
  assert.strictEqual(r.items[1].unit_price_orig, 1.20);
});

// ============================================================
// Cancellation pairs
// ============================================================

test('detectPairs: exact +X / -X for same product → cancellation card, no items', () => {
  const r = detectPairs([
    pi('Mayb.Rose AF 0,75l', 1,  2.99, 'Алкоголь'),
    pi('Mayb.Rose AF 0,75l', 1, -2.99, 'Алкоголь'),
  ]);
  assert.strictEqual(r.items.length, 0);
  assert.strictEqual(r.cancellations.length, 1);
  assert.strictEqual(r.cancellations[0].product_name, 'Mayb.Rose AF 0,75l');
  assert.strictEqual(r.cancellations[0].qty, 1);
  assert.strictEqual(r.cancellations[0].unit_price_orig, 2.99);
});

test('detectPairs: cancellation pair where negative comes first', () => {
  const r = detectPairs([
    pi('X', 1, -2.99),
    pi('X', 1,  2.99),
  ]);
  assert.strictEqual(r.items.length, 0);
  assert.strictEqual(r.cancellations.length, 1);
});

test('detectPairs: cancellation tolerates float drift (2.99 - 2.98 ≠ exactly 0.01)', () => {
  // posTotal=2.99, negTotalAbs=2.98 → at 2dp these round to different cents.
  // This is a 1-cent discount, NOT a cancellation.
  const r = detectPairs([
    pi('X', 1,  2.99),
    pi('X', 1, -2.98),
  ]);
  assert.strictEqual(r.cancellations.length, 0);
  assert.strictEqual(r.items.length, 1);
  assert.strictEqual(r.items[0].discount_orig, 2.98);
});

test('detectPairs: float-drifty cancellation (2.99 + a wisp) still merges via 2dp rounding', () => {
  // Simulate IEEE 754 noise: -2.99 represented imprecisely after a JSON
  // round-trip. The detector rounds totals to 2dp before comparing so this
  // doesn't slip into the discount branch.
  const noisy = -2.99 + 1e-15;
  const r = detectPairs([
    pi('X', 1,  2.99),
    pi('X', 1, noisy),
  ]);
  assert.strictEqual(r.cancellations.length, 1);
  assert.strictEqual(r.items.length, 0);
});

// ============================================================
// Discount pairs
// ============================================================

test('detectPairs: +5.00 / -1.00 for same product → one merged item, discount_orig=1.00', () => {
  const r = detectPairs([
    pi('Promo Item', 1,  5.00, 'Бакалія'),
    pi('Promo Item', 1, -1.00, 'Бакалія'),
  ]);
  assert.strictEqual(r.items.length, 1);
  assert.strictEqual(r.cancellations.length, 0);
  assert.strictEqual(r.items[0].product_name, 'Promo Item');
  assert.strictEqual(r.items[0].unit_price_orig, 5.00);
  assert.strictEqual(r.items[0].discount_orig, 1.00);
});

test('detectPairs: discount pair where negative comes first → still merges, output preserves positive position', () => {
  const r = detectPairs([
    pi('Other', 1, 9.99),
    pi('X',     1, -1.00),
    pi('X',     1,  5.00),
  ]);
  assert.strictEqual(r.items.length, 2);
  // Positive 'X' was at index 2 → stays at output index 1 (after 'Other').
  assert.strictEqual(r.items[0].product_name, 'Other');
  assert.strictEqual(r.items[1].product_name, 'X');
  assert.strictEqual(r.items[1].discount_orig, 1.00);
});

// ============================================================
// Ambiguous / not-our-case
// ============================================================

test('detectPairs: qty mismatch → leave both rows untouched', () => {
  const r = detectPairs([
    pi('X', 2,  2.99),
    pi('X', 1, -2.99),
  ]);
  assert.strictEqual(r.items.length, 2);
  assert.strictEqual(r.cancellations.length, 0);
});

test('detectPairs: 3+ occurrences of same name → leave all untouched', () => {
  const r = detectPairs([
    pi('X', 1,  2.99),
    pi('X', 1,  2.99),
    pi('X', 1, -2.99),
  ]);
  assert.strictEqual(r.items.length, 3);
  assert.strictEqual(r.cancellations.length, 0);
});

test('detectPairs: lone negative item (Pfand without positive twin) is preserved', () => {
  const r = detectPairs([
    pi('Apfel', 1, 1.99, 'Овочі/фрукти'),
    pi('Leergut Einw.allg.', 1, -8.25, 'Pfand'),
  ]);
  assert.strictEqual(r.items.length, 2);
  assert.strictEqual(r.items[1].unit_price_orig, -8.25);
});

test('detectPairs: two positive entries (bought 2 separately) → both kept, no merge', () => {
  const r = detectPairs([
    pi('X', 1, 2.99),
    pi('X', 1, 2.99),
  ]);
  assert.strictEqual(r.items.length, 2);
  assert.strictEqual(r.cancellations.length, 0);
});

test('detectPairs: refund larger than purchase → leave both, do not invent merge', () => {
  const r = detectPairs([
    pi('X', 1,  1.00),
    pi('X', 1, -5.00),
  ]);
  assert.strictEqual(r.items.length, 2);
  assert.strictEqual(r.cancellations.length, 0);
});

// ============================================================
// Normalization
// ============================================================

test('detectPairs: matching is case-insensitive', () => {
  const r = detectPairs([
    pi('Mayb.Rose', 1,  2.99),
    pi('mayb.rose', 1, -2.99),
  ]);
  assert.strictEqual(r.cancellations.length, 1);
});

test('detectPairs: matching trims whitespace', () => {
  const r = detectPairs([
    pi('  X ', 1,  2.99),
    pi('X',    1, -2.99),
  ]);
  assert.strictEqual(r.cancellations.length, 1);
});

// ============================================================
// Realistic EDEKA fixture (mixed: cancellation + Pfand stragglers + ordinary)
// ============================================================

test('detectPairs: EDEKA mix — cancellation pair collapses, Pfand stays, ordinary kept', () => {
  const items = [
    pi('Mayb.Rose AF 0,75l', 1,  2.99, 'Алкоголь'),
    pi('Mayb.Rose AF 0,75l', 1, -2.99, 'Алкоголь'),
    pi('Brot 500g',          1,  1.99, 'Бакалія'),
    pi('Leergut Einw.allg.', 1, -0.25, 'Pfand'),
  ];
  const r = detectPairs(items);
  assert.strictEqual(r.items.length, 2);
  assert.strictEqual(r.items[0].product_name, 'Brot 500g');
  assert.strictEqual(r.items[1].product_name, 'Leergut Einw.allg.');
  assert.strictEqual(r.cancellations.length, 1);
  assert.strictEqual(r.cancellations[0].product_name, 'Mayb.Rose AF 0,75l');
});
