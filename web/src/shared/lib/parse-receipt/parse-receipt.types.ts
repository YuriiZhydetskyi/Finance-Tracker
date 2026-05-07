import type { ParsedReceipt } from '@finance-tracker/domain';

export type ParseReceiptInput = {
  /** Base64 encoded image bytes (no `data:` prefix). */
  imageBase64: string;
  /** MIME type of the image. Defaults to image/jpeg. */
  mimeType?: string;
  /** Allowed category names — used by the AI to constrain its `category_suggestion` output. */
  categories: string[];
  /** Known product names from prior receipts — soft hints to the model, not enforced. */
  products?: { name: string }[];
};

/**
 * Parses a receipt image to a structured ParsedReceipt via an AI provider.
 * Implementation hides where the call happens (Edge Function today; could be
 * a different runtime tomorrow) and which AI is upstream (Gemini → Claude
 * fallback today; could add OpenAI tomorrow).
 */
export type IParseReceiptService = {
  parse(input: ParseReceiptInput): Promise<ParsedReceipt>;
};
