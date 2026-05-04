/**
 * AiClient: provider-agnostic switch over Config.AI_PROVIDER. Each provider
 * file (Gemini.js, OpenAi.js, Anthropic.js) implements an identical
 * parseReceipt(imageBytes, ctx) → ParsedReceipt contract.
 *
 * See ADR-0003 for the rationale and changelog (3-flash-preview, sync return).
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
      case 'gemini':    return Gemini.parseReceipt(imageBytes, ctx);
      case 'openai':    return OpenAi.parseReceipt(imageBytes, ctx);
      case 'anthropic': return Anthropic.parseReceipt(imageBytes, ctx);
      default: throw new Error(`Unknown AI_PROVIDER: "${Config.AI_PROVIDER}". Expected one of: gemini, openai, anthropic.`);
    }
  },
};

// CommonJS export for local Node test runner. Apps Script: no-op.
// eslint-disable-next-line no-undef
if (typeof module !== 'undefined') module.exports = { AiClient };
