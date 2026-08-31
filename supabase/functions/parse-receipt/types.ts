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
};

export type ParsedReceipt = {
  store: string | null;
  store_address?: string | null;
  date: string | null;
  time?: string | null;
  currency: string;
  total_orig: number | null;
  items: ParsedItem[];
};

export type BulkParsedDocument = ParsedReceipt & {
  document_kind: 'receipt' | 'not_receipt' | 'uncertain';
  classification_reason: string;
};

export type AiContext = {
  /** Allowed category names. Used to constrain category_suggestion via JSON schema enum. */
  categories: string[];
  /** Known product names from prior receipts — passed as a soft hint, not enforced. */
  products: { name: string }[];
  /** MIME of the inline image bytes. Default 'image/jpeg'. */
  mimeType: string;
};
