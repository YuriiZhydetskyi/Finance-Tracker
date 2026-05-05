/**
 * Anthropic: receipt parser via Claude Sonnet (multimodal Messages API).
 *
 * Endpoint: POST {ANTHROPIC_API_URL}
 * Auth:     x-api-key header (Config.ANTHROPIC_API_KEY → Script Property).
 * Output:   forced tool_use on a `record_receipt` tool whose input_schema is
 *           the same JSON schema Gemini uses (Gemini._buildSchema). Image is
 *           sent inline as base64.
 *
 * Returns ParsedReceipt synchronously — UrlFetchApp.fetch blocks. Wired as
 * automatic fallback for Gemini in AiClient (see ADR-0011); not selected
 * directly via Config.AI_PROVIDER unless overridden.
 *
 * The text prompt and JSON schema are reused from Gemini._buildPrompt /
 * Gemini._buildSchema. They are pure functions; sharing them prevents the
 * primary and fallback providers from drifting on the load-bearing prompt
 * (negative-line-item rules, allowed categories, etc).
 */

/* exported Anthropic */
const Anthropic = {

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
      model: Config.ANTHROPIC_MODEL,
      max_tokens: Config.ANTHROPIC_MAX_TOKENS,
      temperature: Config.AI_TEMPERATURE,
      tools: [{
        name: 'record_receipt',
        description: 'Record the parsed receipt fields and line items.',
        input_schema: Gemini._buildSchema(ctx),
      }],
      tool_choice: { type: 'tool', name: 'record_receipt', disable_parallel_tool_use: true },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
          { type: 'text', text: Gemini._buildPrompt(ctx) },
        ],
      }],
    };

    const response = UrlFetchApp.fetch(Config.ANTHROPIC_API_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-api-key': Config.ANTHROPIC_API_KEY,
        'anthropic-version': Config.ANTHROPIC_VERSION,
      },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });

    const code = response.getResponseCode();
    if (code !== 200) {
      throw new Error(`Anthropic API error ${code}: ${response.getContentText().slice(0, 500)}`);
    }

    const wrapper = JSON.parse(response.getContentText());
    const blocks = (wrapper && wrapper.content) || [];
    const toolUse = blocks.find(b => b && b.type === 'tool_use' && b.name === 'record_receipt');
    if (!toolUse || !toolUse.input) {
      throw new Error('Anthropic returned no tool_use block. Response: ' + response.getContentText().slice(0, 500));
    }

    /** @type {ParsedReceipt} */
    const parsed = toolUse.input;
    Domain.validateParsedReceipt(parsed);
    return parsed;
  },
};

// CommonJS export for local Node test runner. Apps Script: no-op.
// eslint-disable-next-line no-undef
if (typeof module !== 'undefined') module.exports = { Anthropic };
