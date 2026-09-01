// Types are intentionally duplicated from packages/domain/src/schemas.ts.
// Reason: Deno can't cleanly resolve our Vite-style domain workspace package,
// and the Edge Function is small + portable enough that a 25-line mirror is
// preferable to import-map gymnastics. The client validates returned objects
// against the canonical ParsedReceiptSchema from @finance-tracker/domain
// before consuming them — that validation is the single source of truth.

export type ParsedItem = {
  product_name: string;
  qty: number;
  unit_price_orig: number;
  category_suggestion: string | null;
  discount_orig?: number;
  product_code?: string | null;
  /** 1-based position of the physical financial row in the document. */
  source_ordinal?: number;
  /** Short verbatim transcription of the row(s) used for this item. */
  raw_text?: string;
  row_kind?: 'item' | 'discount' | 'deposit' | 'refund' | 'cancellation';
  qty_evidence?: 'implicit_one' | 'explicit_multiplier' | 'weight_or_volume';
  /** Printed total for this row, when the receipt shows one separately. */
  printed_line_total_orig?: number | null;
  /** VAT class printed in a separate rightmost column; never an item quantity. */
  tax_class?: '1' | '2' | null;
};

export type ParsedReceipt = {
  store: string | null;
  store_address?: string | null;
  date: string | null;
  time?: string | null;
  /** Canonical-source metadata, retained in raw OCR audit records. */
  time_source?: ReceiptTimeSource | null;
  time_raw_text?: string | null;
  /** Fiscal-sale timestamp and evidence, preferred over a payment timestamp. */
  fiscal_time?: string | null;
  fiscal_time_raw_text?: string | null;
  /** Card-payment timestamp and evidence, used only when fiscal time is absent. */
  payment_time?: string | null;
  payment_time_raw_text?: string | null;
  currency: string;
  total_orig: number | null;
  items: ParsedItem[];
};

export type ReceiptTimeSource = 'fiscal_receipt' | 'payment_receipt' | 'other';

export type BulkParsedDocument = ParsedReceipt & {
  document_kind: 'receipt' | 'not_receipt' | 'uncertain';
  classification_reason: string;
  /** Verbatim label and amount from the final amount-due row. */
  total_raw_text?: string | null;
  /** Exact item/article count printed by the register, never derived from emitted rows. */
  article_count?: number | null;
  /** Verbatim label and count, for example "22 Artikel". */
  article_count_raw_text?: string | null;
};

/**
 * A bounded, absolute-ordinal slice of a long receipt. Metadata is repeated on
 * every slice so the worker can fail closed when separate readings disagree.
 */
export type BulkReceiptChunk = BulkParsedDocument & {
  chunk_start_ordinal: number;
  has_more: boolean;
};

export type AiCallTrace = {
  provider: 'gemini' | 'anthropic';
  model: string;
  thinkingLevel?: string;
  mediaResolution?: string;
  stopReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  requestId?: string;
};

export type AiCallResult<T> = {
  value: T;
  trace: AiCallTrace;
};

export type BulkParseMode = 'standard' | 'verification';

export type AiContext = {
  /** Allowed category names. Used to constrain category_suggestion via JSON schema enum. */
  categories: string[];
  /** Known product names from prior receipts — passed as a soft hint, not enforced. */
  products: { name: string }[];
  /** MIME of the inline image bytes. Default 'image/jpeg'. */
  mimeType: string;
};
