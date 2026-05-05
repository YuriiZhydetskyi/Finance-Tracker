/**
 * Tests for src/Anthropic.js.
 *
 * Anthropic shares Gemini's prompt and JSON schema (see Anthropic.parseReceipt
 * doc). These tests verify the network shape unique to the Messages API:
 *   - tool_use forced via tool_choice → input is the ParsedReceipt
 *   - non-200 surfaces with status code in message
 *   - response missing the tool_use block → throws
 *   - validateParsedReceipt rejection propagates
 *   - negative prices accepted (Pfand / Leergut / cancellation rows)
 */

const test = require('node:test');
const assert = require('node:assert');

const { fakes, resetAllFakes, Anthropic, Config } = require('./bootstrap');

const ENDPOINT = Config.ANTHROPIC_API_URL;

function anthropicResponse(parsedReceiptObj) {
  return {
    content: JSON.stringify({
      content: [{
        type: 'tool_use',
        id: 'toolu_test',
        name: 'record_receipt',
        input: parsedReceiptObj,
      }],
    }),
  };
}

// ============================================================
// parseReceipt — happy path
// ============================================================

test('Anthropic.parseReceipt: happy path with stubbed UrlFetchApp', () => {
  resetAllFakes();
  const sample = {
    store: 'ALDI',
    date: '2026-05-04',
    currency: 'EUR',
    total_orig: 5.49,
    items: [
      { product_name: 'Brot', qty: 1, unit_price_orig: 1.99, category_suggestion: 'Бакалія' },
      { product_name: 'Milch 1L', qty: 2, unit_price_orig: 1.75, category_suggestion: 'Молочка' },
    ],
  };
  fakes.UrlFetchApp._setStub(ENDPOINT, anthropicResponse(sample));

  const result = Anthropic.parseReceipt('fake-base64-string', {
    categories: ['Молочка', 'Бакалія'],
    products: [],
  });
  assert.strictEqual(result.store, 'ALDI');
  assert.strictEqual(result.items.length, 2);
  assert.strictEqual(result.items[0].product_name, 'Brot');
});

// ============================================================
// parseReceipt — error paths
// ============================================================

test('Anthropic.parseReceipt: throws on non-200 with status code in message', () => {
  resetAllFakes();
  fakes.UrlFetchApp._setStub(ENDPOINT, { code: 503, content: '{"error":{"type":"overloaded"}}' });
  assert.throws(
    () => Anthropic.parseReceipt('x', { categories: [], products: [] }),
    /Anthropic API error 503/,
  );
});

test('Anthropic.parseReceipt: throws when response has no tool_use block', () => {
  resetAllFakes();
  fakes.UrlFetchApp._setStub(ENDPOINT, {
    content: JSON.stringify({
      content: [{ type: 'text', text: 'I refuse to call the tool.' }],
    }),
  });
  assert.throws(
    () => Anthropic.parseReceipt('x', { categories: [], products: [] }),
    /no tool_use/,
  );
});

test('Anthropic.parseReceipt: throws when content array is empty', () => {
  resetAllFakes();
  fakes.UrlFetchApp._setStub(ENDPOINT, { content: JSON.stringify({ content: [] }) });
  assert.throws(
    () => Anthropic.parseReceipt('x', { categories: [], products: [] }),
    /no tool_use/,
  );
});

test('Anthropic.parseReceipt: rejects responses that fail validateParsedReceipt', () => {
  resetAllFakes();
  // currency missing → validator throws.
  fakes.UrlFetchApp._setStub(ENDPOINT, anthropicResponse({ items: [] }));
  assert.throws(
    () => Anthropic.parseReceipt('x', { categories: [], products: [] }),
    /Invalid ParsedReceipt/,
  );
});

// ============================================================
// parseReceipt — negative prices (Pfand / discount / cancellation)
// ============================================================

test('Anthropic.parseReceipt: accepts negative unit_price_orig (Pfand refund, discount, cancellation)', () => {
  resetAllFakes();
  const sample = {
    store: 'EDEKA',
    date: '2026-05-02',
    currency: 'EUR',
    total_orig: 33.44,
    items: [
      { product_name: 'Mayb.Rose AF 0,75l', qty: 1, unit_price_orig: 2.99, category_suggestion: null },
      { product_name: 'Mayb.Rose AF 0,75l', qty: 1, unit_price_orig: 2.99, category_suggestion: null },
      { product_name: 'Mayb.Rose AF 0,75l', qty: 1, unit_price_orig: -2.99, category_suggestion: null }, // cancellation
      { product_name: 'Pfand', qty: 1, unit_price_orig: 0.25, category_suggestion: 'Pfand' },
      { product_name: 'Leergut Entl.allg.', qty: 1, unit_price_orig: -1.19, category_suggestion: 'Pfand' },
      { product_name: 'Leergut Einw.allg.', qty: 1, unit_price_orig: -8.25, category_suggestion: 'Pfand' },
    ],
  };
  fakes.UrlFetchApp._setStub(ENDPOINT, anthropicResponse(sample));

  const result = Anthropic.parseReceipt('x', { categories: ['Pfand'], products: [] });
  assert.strictEqual(result.items.length, 6);
  assert.strictEqual(result.items[2].unit_price_orig, -2.99);
  assert.strictEqual(result.items[4].unit_price_orig, -1.19);
  assert.strictEqual(result.items[5].unit_price_orig, -8.25);
  assert.ok(result.items.every(it => it.qty > 0), 'qty went non-positive');
});
