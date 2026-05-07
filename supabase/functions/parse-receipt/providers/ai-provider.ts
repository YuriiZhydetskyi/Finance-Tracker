// Strategy interface for receipt-OCR providers. Adding a third (e.g. OpenAI)
// is a new file in this directory + one line in handler.ts to register it as
// fallback or primary — open/closed.

import type { AiContext, ParsedReceipt } from '../types.ts';

export interface IAiProvider {
  /** Human-readable name for logs ("gemini" / "anthropic"). */
  readonly name: string;
  /**
   * Parse a receipt image to ParsedReceipt. Implementations enforce the JSON
   * shape via provider-native mechanisms (Gemini: responseJsonSchema; Claude:
   * tool_use input_schema). The orchestrator does NOT validate the result —
   * the client is the source of truth for runtime validation (Zod).
   */
  parse(imageBase64: string, ctx: AiContext): Promise<ParsedReceipt>;
}
