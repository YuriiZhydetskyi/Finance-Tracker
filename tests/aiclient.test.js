/**
 * Tests for src/AiClient.js — provider-agnostic switch over Config.AI_PROVIDER.
 */

const test = require('node:test');
const assert = require('node:assert');

const { AiClient, Config } = require('./bootstrap');

// Save and restore the global provider so test order doesn't matter.
const originalProvider = Config.AI_PROVIDER;
test.afterEach(() => { Config.AI_PROVIDER = originalProvider; });

test('AiClient.parseReceipt: routes to Gemini when AI_PROVIDER="gemini"', () => {
  Config.AI_PROVIDER = 'gemini';
  const originalParse = global.Gemini.parseReceipt;
  let called = false;
  global.Gemini.parseReceipt = () => { called = true; return /** @type {any} */ ({ items: [], currency: 'EUR' }); };
  try {
    AiClient.parseReceipt('base64-payload', { categories: [], products: [] });
    assert.ok(called, 'Gemini.parseReceipt should be called');
  } finally {
    global.Gemini.parseReceipt = originalParse;
  }
});

test('AiClient.parseReceipt: routes to OpenAi stub (throws Not implemented)', () => {
  Config.AI_PROVIDER = 'openai';
  assert.throws(
    () => AiClient.parseReceipt('x', { categories: [], products: [] }),
    /not implemented/i,
  );
});

test('AiClient.parseReceipt: routes to Anthropic stub (throws Not implemented)', () => {
  Config.AI_PROVIDER = 'anthropic';
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
