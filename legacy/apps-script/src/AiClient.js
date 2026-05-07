/**
 * AiClient: provider-agnostic switch over Config.AI_PROVIDER. Each provider
 * file (Gemini.js, OpenAi.js, Anthropic.js) implements an identical
 * parseReceipt(imageBytes, ctx) → ParsedReceipt contract.
 *
 * When AI_PROVIDER is 'gemini', Anthropic Claude Sonnet 4.6 is wired as an
 * automatic fallback: any error from Gemini triggers a single retry against
 * Claude. The user-visible error is raised only if both providers fail. See
 * ADR-0003 (provider abstraction) and ADR-0011 (Claude fallback).
 */

/* exported AiClient */
const AiClient = {
  /**
   * Parse a receipt image to a ParsedReceipt via the configured provider.
   * @param {number[] | string} imageBytes - byte array from Blob.getBytes() (preferred) or pre-encoded base64 string
   * @param {{categories: string[], products: Product[]}} ctx
   * @returns {ParsedReceipt}
   */
  parseReceipt(imageBytes, ctx) {
    switch (Config.AI_PROVIDER) {
      case 'gemini':    return AiClient._geminiWithClaudeFallback(imageBytes, ctx);
      case 'openai':    return OpenAi.parseReceipt(imageBytes, ctx);
      case 'anthropic': return Anthropic.parseReceipt(imageBytes, ctx);
      default: throw new Error(`Unknown AI_PROVIDER: "${Config.AI_PROVIDER}". Expected one of: gemini, openai, anthropic.`);
    }
  },

  /**
   * Try Gemini first; on any error fall back to Claude. If Claude also fails,
   * surface a combined error so the UI can show both messages. Logs which
   * provider succeeded so fallback rate is visible in Apps Script Executions.
   * @param {number[] | string} imageBytes
   * @param {{categories: string[], products: Product[]}} ctx
   * @returns {ParsedReceipt}
   */
  _geminiWithClaudeFallback(imageBytes, ctx) {
    try {
      return Gemini.parseReceipt(imageBytes, ctx);
    } catch (geminiErr) {
      Logger.log(`AiClient: Gemini failed, falling back to Claude. Gemini error: ${geminiErr.message}`);
      try {
        const result = Anthropic.parseReceipt(imageBytes, ctx);
        Logger.log('AiClient: Claude fallback succeeded.');
        return result;
      } catch (claudeErr) {
        throw new Error(
          `AI parsing failed (both providers). Gemini: ${geminiErr.message} | Claude: ${claudeErr.message}`
        );
      }
    }
  },
};

// CommonJS export for local Node test runner. Apps Script: no-op.
// eslint-disable-next-line no-undef
if (typeof module !== 'undefined') module.exports = { AiClient };
