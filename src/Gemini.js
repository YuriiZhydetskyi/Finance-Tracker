/**
 * Gemini: receipt parser via Gemini Flash multimodal API.
 *
 * Endpoint: POST {GEMINI_API_URL_BASE}/{GEMINI_MODEL}:generateContent
 * Auth: x-goog-api-key header (Config.GEMINI_API_KEY → Script Property).
 * Output: JSON enforced by generationConfig.responseJsonSchema (see
 *   _buildSchema). Image is sent inline as base64.
 *
 * Returns ParsedReceipt synchronously — UrlFetchApp.fetch blocks. Caller
 * (Phase 3 Web.js / runServer wrapper) lifts this into a Promise on the
 * client side.
 *
 * Schema reference: docs/decisions/0003-gemini-with-provider-abstraction.md
 */

/* exported Gemini */
const Gemini = {

  /**
   * @param {number[] | string} imageBytes - byte array from Blob.getBytes() (preferred) or pre-encoded base64 string
   * @param {{categories: string[], products: Product[]}} ctx
   * @returns {ParsedReceipt}
   */
  parseReceipt(imageBytes, ctx) {
    const base64 = (typeof imageBytes === 'string')
      ? imageBytes
      : Utilities.base64Encode(imageBytes);

    const body = {
      contents: [{
        parts: [
          { text: Gemini._buildPrompt(ctx) },
          { inline_data: { mime_type: 'image/jpeg', data: base64 } },
        ],
      }],
      generationConfig: {
        temperature: Config.AI_TEMPERATURE,
        responseMimeType: 'application/json',
        responseJsonSchema: Gemini._buildSchema(ctx),
      },
    };

    const url = `${Config.GEMINI_API_URL_BASE}/${Config.GEMINI_MODEL}:generateContent`;
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': Config.GEMINI_API_KEY },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });

    const code = response.getResponseCode();
    if (code !== 200) {
      throw new Error(`Gemini API error ${code}: ${response.getContentText().slice(0, 500)}`);
    }

    const wrapper = JSON.parse(response.getContentText());
    const text = wrapper
      && wrapper.candidates
      && wrapper.candidates[0]
      && wrapper.candidates[0].content
      && wrapper.candidates[0].content.parts
      && wrapper.candidates[0].content.parts[0]
      && wrapper.candidates[0].content.parts[0].text;
    if (!text) {
      throw new Error('Gemini returned no candidates with text. Response: ' + response.getContentText().slice(0, 500));
    }

    /** @type {ParsedReceipt} */
    const parsed = JSON.parse(text);
    Domain.validateParsedReceipt(parsed);
    return parsed;
  },

  /**
   * Build the text prompt sent alongside the image. Pure function — testable
   * without network or Apps Script globals.
   * @param {{categories: string[], products: Product[]}} ctx
   * @returns {string}
   */
  _buildPrompt(ctx) {
    const categories = (ctx.categories || []).join(', ');
    const productHints = (ctx.products || []).slice(0, 50).map(p => p.name).join(', ');
    return [
      'Extract receipt line items from this image.',
      '',
      'Return JSON conforming to the response schema. Rules:',
      '- product_name: copy verbatim as printed on the receipt; do not translate or normalize.',
      '- qty: numeric quantity (1.0 if not specified per-line).',
      '- unit_price_orig: numeric price per unit in the receipt currency.',
      '- category_suggestion: one of the listed categories (verbatim) or null if uncertain. Do not invent new categories.',
      '- store: best-effort store/merchant name; null if illegible.',
      '- date: receipt date as YYYY-MM-DD; null if illegible.',
      '- currency: ISO 4217 (e.g. EUR, UAH); default to "EUR" if not visible.',
      '- total_orig: numeric total as printed; null if illegible.',
      '- If a row is a discount or fee (not a product), skip it — list only purchasable line items.',
      '',
      `Allowed categories: ${categories}`,
      productHints
        ? `\nKnown product names from prior purchases (hint only — do not force a match): ${productHints}`
        : '',
    ].join('\n');
  },

  /**
   * JSON schema enforced via generationConfig.responseJsonSchema. Pure.
   * @param {{categories: string[], products?: Product[]}} ctx
   */
  _buildSchema(ctx) {
    const categoryEnum = [...(ctx.categories || []), null];
    return {
      type: 'object',
      properties: {
        store:      { type: ['string', 'null'] },
        date:       { type: ['string', 'null'], description: 'YYYY-MM-DD' },
        currency:   { type: 'string', description: 'ISO 4217 (default EUR)' },
        total_orig: { type: ['number', 'null'] },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              product_name:        { type: 'string' },
              qty:                 { type: 'number' },
              unit_price_orig:     { type: 'number' },
              category_suggestion: { type: ['string', 'null'], enum: categoryEnum },
            },
            required: ['product_name', 'qty', 'unit_price_orig'],
          },
        },
      },
      required: ['currency', 'items'],
    };
  },
};

// CommonJS export for local Node test runner. Apps Script: no-op.
// eslint-disable-next-line no-undef
if (typeof module !== 'undefined') module.exports = { Gemini };
