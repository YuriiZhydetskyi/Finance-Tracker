/**
 * Anthropic: provider stub. Same signature as Gemini.parseReceipt so AiClient
 * switch compiles even when this provider is selected. To implement, see
 * docs/extending.md recipe 3.
 */

/* exported Anthropic */
const Anthropic = {
  /**
   * @param {number[] | string} _imageBytes
   * @param {Object} _ctx
   * @returns {ParsedReceipt}
   */
  parseReceipt(_imageBytes, _ctx) {
    throw new Error('Anthropic.parseReceipt: not implemented. See docs/extending.md recipe 3.');
  },
};

// CommonJS export for local Node test runner. Apps Script: no-op.
// eslint-disable-next-line no-undef
if (typeof module !== 'undefined') module.exports = { Anthropic };
