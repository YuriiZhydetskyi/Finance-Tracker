/**
 * Tests for src/Gemini.js.
 *
 * Covers:
 *   - _buildPrompt(ctx): contains all categories + product hints (≤50)
 *   - _buildSchema(ctx): correct shape; category enum includes ctx.categories + null
 *   - parseReceipt: happy path with stubbed UrlFetchApp
 *   - parseReceipt: non-200 → throws with status code
 *   - parseReceipt: empty candidates → throws
 *   - parseReceipt: invalid JSON in candidate text → throws
 *   - parseReceipt: validateParsedReceipt rejection propagates
 */

const test = require('node:test');
const assert = require('node:assert');

const { fakes, resetAllFakes, Gemini, Config } = require('./bootstrap');

const ENDPOINT = `${Config.GEMINI_API_URL_BASE}/${Config.GEMINI_MODEL}:generateContent`;

function geminiResponse(parsedReceiptObj) {
  return {
    content: JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(parsedReceiptObj) }] } }],
    }),
  };
}

// ============================================================
// _buildPrompt (pure)
// ============================================================

test('Gemini._buildPrompt: lists all categories', () => {
  const prompt = Gemini._buildPrompt({
    categories: ['Молочка', 'Бакалія', 'Алкоголь'],
    products: [],
  });
  assert.match(prompt, /Молочка/);
  assert.match(prompt, /Бакалія/);
  assert.match(prompt, /Алкоголь/);
  assert.match(prompt, /Allowed categories/);
});

test('Gemini._buildPrompt: includes product hints when products provided', () => {
  const products = Array.from({ length: 60 }, (_, i) => ({ name: `Product${i}` }));
  const prompt = Gemini._buildPrompt({ categories: ['X'], products });
  assert.match(prompt, /Known product names/);
  assert.match(prompt, /Product0/);
  assert.match(prompt, /Product49/);
  assert.ok(!prompt.includes('Product50'), 'should cap at 50 hints');
});

test('Gemini._buildPrompt: omits product hints section when none provided', () => {
  const prompt = Gemini._buildPrompt({ categories: ['X'], products: [] });
  assert.ok(!prompt.includes('Known product names'), 'no hints line if products empty');
});

// ============================================================
// _buildSchema (pure)
// ============================================================

test('Gemini._buildSchema: top-level required is currency + items', () => {
  const schema = Gemini._buildSchema({ categories: ['A'] });
  assert.deepStrictEqual(schema.required, ['currency', 'items']);
});

test('Gemini._buildSchema: item required is product_name + qty + unit_price_orig', () => {
  const schema = Gemini._buildSchema({ categories: ['A'] });
  assert.deepStrictEqual(
    schema.properties.items.items.required,
    ['product_name', 'qty', 'unit_price_orig'],
  );
});

test('Gemini._buildSchema: category_suggestion enum is ctx.categories + null', () => {
  const schema = Gemini._buildSchema({ categories: ['A', 'B', 'C'] });
  const enumVals = schema.properties.items.items.properties.category_suggestion.enum;
  assert.deepStrictEqual(enumVals, ['A', 'B', 'C', null]);
});

test('Gemini._buildSchema: nullable fields use type arrays', () => {
  const schema = Gemini._buildSchema({ categories: [] });
  assert.deepStrictEqual(schema.properties.store.type, ['string', 'null']);
  assert.deepStrictEqual(schema.properties.date.type, ['string', 'null']);
  assert.deepStrictEqual(schema.properties.total_orig.type, ['number', 'null']);
});

// ============================================================
// parseReceipt
// ============================================================

test('Gemini.parseReceipt: happy path with stubbed UrlFetchApp', () => {
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
  fakes.UrlFetchApp._setStub(ENDPOINT, geminiResponse(sample));

  const result = Gemini.parseReceipt('fake-base64-string', {
    categories: ['Молочка', 'Бакалія'],
    products: [],
  });
  assert.strictEqual(result.store, 'ALDI');
  assert.strictEqual(result.items.length, 2);
  assert.strictEqual(result.items[0].product_name, 'Brot');
});

test('Gemini.parseReceipt: throws on non-200 with status code in message', () => {
  resetAllFakes();
  fakes.UrlFetchApp._setStub(ENDPOINT, { code: 401, content: '{"error":"invalid api key"}' });
  assert.throws(
    () => Gemini.parseReceipt('x', { categories: [], products: [] }),
    /Gemini API error 401/,
  );
});

test('Gemini.parseReceipt: throws when candidates array is empty', () => {
  resetAllFakes();
  fakes.UrlFetchApp._setStub(ENDPOINT, { content: JSON.stringify({ candidates: [] }) });
  assert.throws(
    () => Gemini.parseReceipt('x', { categories: [], products: [] }),
    /no candidates/,
  );
});

test('Gemini.parseReceipt: propagates JSON.parse failure on malformed candidate text', () => {
  resetAllFakes();
  fakes.UrlFetchApp._setStub(ENDPOINT, {
    content: JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{not valid json' }] } }],
    }),
  });
  assert.throws(
    () => Gemini.parseReceipt('x', { categories: [], products: [] }),
    SyntaxError,
  );
});

test('Gemini.parseReceipt: rejects responses that fail validateParsedReceipt', () => {
  resetAllFakes();
  // currency missing → validator throws.
  fakes.UrlFetchApp._setStub(ENDPOINT, geminiResponse({ items: [] }));
  assert.throws(
    () => Gemini.parseReceipt('x', { categories: [], products: [] }),
    /Invalid ParsedReceipt/,
  );
});
