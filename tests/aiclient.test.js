/**
 * Tests for src/AiClient.js — provider switch + Gemini→Claude fallback (ADR-0011).
 */

const test = require('node:test');
const assert = require('node:assert');

const { AiClient, Config } = require('./bootstrap');

// Save and restore globals so test order doesn't matter.
const originalProvider = Config.AI_PROVIDER;
const originalGeminiParse = global.Gemini.parseReceipt;
const originalAnthropicParse = global.Anthropic.parseReceipt;

test.afterEach(() => {
  Config.AI_PROVIDER = originalProvider;
  global.Gemini.parseReceipt = originalGeminiParse;
  global.Anthropic.parseReceipt = originalAnthropicParse;
});

const FAKE_RECEIPT = /** @type {any} */ ({ items: [], currency: 'EUR' });

// ============================================================
// AI_PROVIDER='gemini' — primary success path (no fallback)
// ============================================================

test('AiClient.parseReceipt: AI_PROVIDER="gemini" calls Gemini and skips Claude on success', () => {
  Config.AI_PROVIDER = 'gemini';
  let geminiCalled = false;
  let anthropicCalled = false;
  global.Gemini.parseReceipt = () => { geminiCalled = true; return FAKE_RECEIPT; };
  global.Anthropic.parseReceipt = () => { anthropicCalled = true; return FAKE_RECEIPT; };

  AiClient.parseReceipt('img', { categories: [], products: [] });
  assert.ok(geminiCalled, 'Gemini should be called');
  assert.ok(!anthropicCalled, 'Claude should NOT be called when Gemini succeeds');
});

// ============================================================
// AI_PROVIDER='gemini' — Gemini fails, Claude rescues
// ============================================================

test('AiClient.parseReceipt: falls back to Claude when Gemini throws', () => {
  Config.AI_PROVIDER = 'gemini';
  let anthropicCalled = false;
  global.Gemini.parseReceipt = () => { throw new Error('Gemini API error 503: overloaded'); };
  global.Anthropic.parseReceipt = () => { anthropicCalled = true; return FAKE_RECEIPT; };

  const result = AiClient.parseReceipt('img', { categories: [], products: [] });
  assert.ok(anthropicCalled, 'Claude should be called after Gemini throws');
  assert.strictEqual(result, FAKE_RECEIPT);
});

// ============================================================
// AI_PROVIDER='gemini' — both fail → combined error
// ============================================================

test('AiClient.parseReceipt: throws combined error when both Gemini and Claude fail', () => {
  Config.AI_PROVIDER = 'gemini';
  global.Gemini.parseReceipt = () => { throw new Error('Gemini API error 503'); };
  global.Anthropic.parseReceipt = () => { throw new Error('Anthropic API error 529'); };

  assert.throws(
    () => AiClient.parseReceipt('img', { categories: [], products: [] }),
    (err) => {
      assert.match(err.message, /both providers/i);
      assert.match(err.message, /Gemini.*503/);
      assert.match(err.message, /Claude.*529/);
      return true;
    },
  );
});

// ============================================================
// AI_PROVIDER='anthropic' — direct call, no fallback
// ============================================================

test('AiClient.parseReceipt: AI_PROVIDER="anthropic" calls Claude directly without Gemini', () => {
  Config.AI_PROVIDER = 'anthropic';
  let geminiCalled = false;
  let anthropicCalled = false;
  global.Gemini.parseReceipt = () => { geminiCalled = true; return FAKE_RECEIPT; };
  global.Anthropic.parseReceipt = () => { anthropicCalled = true; return FAKE_RECEIPT; };

  AiClient.parseReceipt('img', { categories: [], products: [] });
  assert.ok(anthropicCalled, 'Claude should be called');
  assert.ok(!geminiCalled, 'Gemini should NOT be called when AI_PROVIDER is anthropic');
});

test('AiClient.parseReceipt: AI_PROVIDER="anthropic" propagates Claude errors (no fallback chain)', () => {
  Config.AI_PROVIDER = 'anthropic';
  global.Anthropic.parseReceipt = () => { throw new Error('Anthropic API error 401'); };

  assert.throws(
    () => AiClient.parseReceipt('img', { categories: [], products: [] }),
    /Anthropic API error 401/,
  );
});

// ============================================================
// Other branches
// ============================================================

test('AiClient.parseReceipt: routes to OpenAi stub (throws Not implemented)', () => {
  Config.AI_PROVIDER = 'openai';
  assert.throws(
    () => AiClient.parseReceipt('x', { categories: [], products: [] }),
    /not implemented/i,
  );
});

test('AiClient.parseReceipt: throws on unknown provider', () => {
  Config.AI_PROVIDER = 'bogus';
  assert.throws(
    () => AiClient.parseReceipt('x', { categories: [], products: [] }),
    /Unknown AI_PROVIDER/,
  );
});
