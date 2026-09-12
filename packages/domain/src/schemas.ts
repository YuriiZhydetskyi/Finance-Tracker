// Authoritative Zod schemas — single source of truth for both runtime validation
// and TypeScript types (via z.infer). Mirrors docs/data-model.md.
//
// Schemas are vendor-free (no React, no Supabase). They're imported by:
//   - the React client (hooks, forms, optimistic updates)
//   - the Supabase Edge Function `parse-receipt` (post-AI validation)

import { z } from 'zod';
import { isValidConsumedBy } from './consumed-by';
import { ULID_REGEX } from './ulid';
import { ProductClassificationSchema } from './product-taxonomy';
import {
  EU_ALLERGENS,
  NUTRI_SCORES,
  NUTRITION_BASES,
  PACKAGED_PRODUCT_IMPORT_SOURCES,
  PACKAGED_PRODUCT_PHOTO_KINDS,
} from './nutrition';

// ── Reusable atoms ──────────────────────────────────────────────────────────

export const ULID_SCHEMA = z.string().regex(ULID_REGEX, 'Must be a 26-char Crockford ULID');
export const ISO_DATE_SCHEMA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
export const ISO_DATETIME_SCHEMA = z.string().min(1);
// Strict HH:MM:SS — the canonical in-domain shape, matching what PostgREST
// returns for a `time` column and what factories normalize inputs into.
// Form inputs accept HH:MM (browser `<input type="time">`) and the factory
// pads the seconds before validation; see normalizeTime() in factories.ts.
export const ISO_TIME_SCHEMA = z.string().regex(/^\d{2}:\d{2}:\d{2}$/, 'Must be HH:MM:SS');
// Loose HH:MM or HH:MM:SS — used at factory input boundaries (form values,
// AI output) where the source can be either format.
export const ISO_TIME_INPUT_SCHEMA = z
  .string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Must be HH:MM or HH:MM:SS');
export const ISO_4217_CURRENCY_SCHEMA = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Must be ISO 4217 (3 uppercase letters)');
export const EMAIL_LIKE_SCHEMA = z
  .string()
  .min(1)
  .refine((s) => s.includes('@'), { message: 'Must contain @' });
export const CONSUMED_BY_SCHEMA = z.string().refine(isValidConsumedBy, {
  message: 'Invalid consumed_by. Expected: his | hers | shared | custom:N/M (N+M=100)',
});
export const SOURCE_SCHEMA = z.enum(['photo', 'manual', 'edit', 'manual-json', 'statement']);
export const PRODUCT_UNIT_SCHEMA = z.enum(['pcs', 'g', 'kg', 'ml', 'l']);

// ── Receipt ─────────────────────────────────────────────────────────────────

export const ReceiptSchema = z.object({
  id: ULID_SCHEMA,
  date: ISO_DATE_SCHEMA,
  store: z.string().min(1, 'store is required'),
  store_address: z.string().nullable(),
  currency: ISO_4217_CURRENCY_SCHEMA,
  total_orig: z.number().finite(),
  fx_rate_eur: z.number().finite().positive(),
  total_eur: z.number().finite(),
  paid_by: EMAIL_LIKE_SCHEMA,
  photo_url: z.string().nullable(),
  // Default keeps runtime compatibility with pre-migration snapshots while
  // preserving a required, non-undefined Receipt output shape.
  photo_path: z.string().nullable().default(null),
  merchant_order_id: z.string().nullable().default(null),
  source: SOURCE_SCHEMA,
  raw_ocr_json: z.string().max(45_000, 'raw_ocr_json exceeds 45000 chars').nullable(),
  note: z.string().nullable(),
  time: ISO_TIME_SCHEMA.nullable(),
  created_at: ISO_DATETIME_SCHEMA,
  updated_at: ISO_DATETIME_SCHEMA,
});
export type Receipt = z.infer<typeof ReceiptSchema>;

// ── Item ────────────────────────────────────────────────────────────────────

export const ItemSchema = z
  .object({
    id: ULID_SCHEMA,
    receipt_id: ULID_SCHEMA,
    product_id: ULID_SCHEMA.nullable(),
    ...ProductClassificationSchema.shape,
    product_name: z.string().min(1, 'product_name is required'),
    raw_product_name: z.string().min(1, 'raw_product_name is required'),
    store_product_code: z.string().nullable(),
    product_url: z.string().nullable().default(null),
    product_image_url: z.string().nullable().default(null),
    category: z.string().min(1, 'category is required'),
    qty: z.number().finite().positive('qty must be positive number'),
    unit_price_orig: z.number().finite(),
    total_orig: z.number().finite(),
    total_eur: z.number().finite(),
    consumed_by: CONSUMED_BY_SCHEMA,
    note: z.string().nullable(),
    wasted_qty: z.number().finite().nonnegative('wasted_qty must be non-negative number'),
    wasted_at: ISO_DATETIME_SCHEMA.nullable(),
    discount_orig: z.number().finite().nonnegative('discount_orig must be non-negative number'),
    created_at: ISO_DATETIME_SCHEMA,
    updated_at: ISO_DATETIME_SCHEMA,
  })
  .superRefine((it, ctx) => {
    const classification = ProductClassificationSchema.safeParse(it);
    if (!classification.success) {
      for (const issue of classification.error.issues) {
        ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
      }
    }
    if (it.wasted_qty > it.qty) {
      ctx.addIssue({
        code: 'custom',
        message: `wasted_qty (${String(it.wasted_qty)}) cannot exceed qty (${String(it.qty)})`,
        path: ['wasted_qty'],
      });
    }
    if (it.unit_price_orig > 0 && it.discount_orig > it.unit_price_orig) {
      ctx.addIssue({
        code: 'custom',
        message: `discount_orig (${String(it.discount_orig)}) cannot exceed unit_price_orig (${String(it.unit_price_orig)})`,
        path: ['discount_orig'],
      });
    }
    // wasted_at must be present iff wasted_qty > 0.
    if (it.wasted_qty > 0 && it.wasted_at == null) {
      ctx.addIssue({
        code: 'custom',
        message: 'wasted_at is required when wasted_qty > 0',
        path: ['wasted_at'],
      });
    }
    if (it.wasted_qty === 0 && it.wasted_at != null) {
      ctx.addIssue({
        code: 'custom',
        message: 'wasted_at must be null when wasted_qty is 0',
        path: ['wasted_at'],
      });
    }
  });
export type Item = z.infer<typeof ItemSchema>;

// ── Product ─────────────────────────────────────────────────────────────────

export const ProductSchema = z
  .object({
    ...ProductClassificationSchema.shape,
    brand: z.string().trim().min(1).nullable().optional(),
    is_organic: z.boolean().nullable().optional(),
    id: ULID_SCHEMA,
    name: z.string().min(1, 'name is required'),
    store: z.string().min(1, 'store is required'),
    store_product_code: z.string().nullable(),
    category: z.string().min(1, 'category is required'),
    unit: PRODUCT_UNIT_SCHEMA.nullable(),
    unit_size: z.number().finite().nullable(),
    notes: z.string().nullable(),
    created_at: ISO_DATETIME_SCHEMA,
    updated_at: ISO_DATETIME_SCHEMA,
  })
  .refine((value) => ProductClassificationSchema.safeParse(value).success, {
    message: 'A product variant requires a family',
    path: ['product_variant_id'],
  });
export type Product = z.infer<typeof ProductSchema>;

// ── ProductPrice (price-history snapshot) ───────────────────────────────────
// Append-only: one row per saved item line. Both `price_orig` (before discount)
// and `price_net` (after) are stored — orig drives long-term trend charts that
// shouldn't bend under store promotions; net is what was actually paid per unit.

export const ProductPriceSchema = z.object({
  id: ULID_SCHEMA,
  product_id: ULID_SCHEMA,
  receipt_id: ULID_SCHEMA,
  price_orig: z.number().finite(),
  price_net: z.number().finite(),
  currency: ISO_4217_CURRENCY_SCHEMA,
  date: ISO_DATE_SCHEMA,
  created_at: ISO_DATETIME_SCHEMA,
});
export type ProductPrice = z.infer<typeof ProductPriceSchema>;

// ── Parsed (AI output) ──────────────────────────────────────────────────────
// Soft validator: store/date/total_orig may be null because the AI can
// legitimately fail to read those off a noisy receipt.

export const ParsedItemSchema = z.object({
  product_name: z.string().min(1),
  qty: z.number().finite().positive(),
  unit_price_orig: z.number().finite(),
  category_suggestion: z.string().nullable().default(null),
  ...ProductClassificationSchema.shape,
  brand: z.string().trim().min(1).nullable().optional(),
  is_organic: z.boolean().nullable().optional(),
  product_url: z.string().nullable().optional(),
  product_image_url: z.string().nullable().optional(),
  discount_orig: z.number().finite().nonnegative().optional(),
  // Optional + nullable: not every receipt has per-line codes (e.g. Aldi yes,
  // many corner shops no). Optional preserves backward compat for raw_ocr_json
  // snapshots written before this field existed.
  product_code: z.string().nullable().optional(),
  source_ordinal: z.number().int().positive().optional(),
  raw_text: z.string().optional(),
  row_kind: z.enum(['item', 'discount', 'deposit', 'refund', 'cancellation']).optional(),
  qty_evidence: z.enum(['implicit_one', 'explicit_multiplier', 'weight_or_volume']).optional(),
  printed_line_total_orig: z.number().finite().nullable().optional(),
  tax_class: z.enum(['1', '2']).nullable().optional(),
});
export type ParsedItem = z.infer<typeof ParsedItemSchema>;

export const ParsedReceiptSchema = z.object({
  store: z.string().nullable(),
  store_address: z.string().nullable().optional(),
  date: ISO_DATE_SCHEMA.nullable(),
  time: ISO_TIME_INPUT_SCHEMA.nullable().optional(),
  time_source: z.enum(['fiscal_receipt', 'payment_receipt', 'other']).nullable().optional(),
  time_raw_text: z.string().nullable().optional(),
  fiscal_time: ISO_TIME_INPUT_SCHEMA.nullable().optional(),
  fiscal_time_raw_text: z.string().nullable().optional(),
  payment_time: ISO_TIME_INPUT_SCHEMA.nullable().optional(),
  payment_time_raw_text: z.string().nullable().optional(),
  currency: ISO_4217_CURRENCY_SCHEMA,
  total_orig: z.number().finite().nullable(),
  merchant_order_id: z.string().nullable().optional(),
  total_raw_text: z.string().nullable().optional(),
  article_count: z.number().int().nonnegative().nullable().optional(),
  article_count_raw_text: z.string().nullable().optional(),
  items: z.array(ParsedItemSchema),
});
export type ParsedReceipt = z.infer<typeof ParsedReceiptSchema>;

// ── StatementTransaction (orphan card line) ─────────────────────────────────
// A statement line that matched no receipt on import. Persisted so it survives
// reloads, can be re-matched when the real receipt is finally entered, or turned
// into a stub receipt. `amount_orig` is always positive (refunds aren't stored).
// See docs/data-model.md "Таблиця statement_transactions".

export const STATEMENT_TXN_STATUS_SCHEMA = z.enum(['unmatched', 'receipt_created', 'dismissed']);
export type StatementTxnStatus = z.infer<typeof STATEMENT_TXN_STATUS_SCHEMA>;

export const StatementTransactionSchema = z.object({
  id: ULID_SCHEMA,
  date: ISO_DATE_SCHEMA,
  time: ISO_TIME_SCHEMA.nullable(),
  amount_orig: z.number().finite().positive(),
  currency: ISO_4217_CURRENCY_SCHEMA,
  merchant: z.string().nullable(),
  raw: z.string().nullable(),
  paid_by: EMAIL_LIKE_SCHEMA,
  status: STATEMENT_TXN_STATUS_SCHEMA,
  receipt_id: ULID_SCHEMA.nullable(),
  suggested_category: z.string().nullable(),
  dedup_key: z.string().min(1),
  created_at: ISO_DATETIME_SCHEMA,
  updated_at: ISO_DATETIME_SCHEMA,
});
export type StatementTransaction = z.infer<typeof StatementTransactionSchema>;

export const StatementTransactionInputSchema = z.object({
  date: ISO_DATE_SCHEMA,
  time: ISO_TIME_INPUT_SCHEMA.nullable().optional(),
  amount_orig: z.number().finite().positive(),
  currency: ISO_4217_CURRENCY_SCHEMA,
  merchant: z.string().nullable().optional(),
  raw: z.string().nullable().optional(),
  paid_by: EMAIL_LIKE_SCHEMA,
  suggested_category: z.string().nullable().optional(),
  // Ordinal among same-import duplicates (see dedupOccurrences); folds into dedup_key.
  occurrence: z.number().int().nonnegative().optional(),
});
export type StatementTransactionInput = z.infer<typeof StatementTransactionInputSchema>;

// ── StoreAlias (learned statement↔receipt store-name pair) ──────────────────
// Written when the user confirms a reconcile match whose names did not
// fuzzy-match; read back as a Set of keys for storeNamesMatch. Both columns
// hold NORMALIZED names (normalizeStoreName) so the DB unique index dedupes
// case/punctuation variants. See docs/data-model.md "Таблиця store_aliases".

export const StoreAliasSchema = z.object({
  id: ULID_SCHEMA,
  statement_name: z.string().min(1),
  receipt_store: z.string().min(1),
  created_at: ISO_DATETIME_SCHEMA,
});
export type StoreAlias = z.infer<typeof StoreAliasSchema>;

export const StoreAliasInputSchema = z.object({
  statement_name: z.string().min(1),
  receipt_store: z.string().min(1),
});
export type StoreAliasInput = z.infer<typeof StoreAliasInputSchema>;

// ── Factory input shapes ────────────────────────────────────────────────────
// The user-facing inputs to make*() factories. The factory generates id /
// timestamps / derived fields and rounds money. See factories.ts.

export const ReceiptInputSchema = z.object({
  date: ISO_DATE_SCHEMA,
  store: z.string().min(1),
  store_address: z.string().nullable().optional(),
  currency: ISO_4217_CURRENCY_SCHEMA,
  total_orig: z.number().finite(),
  fx_rate_eur: z.number().finite().positive(),
  paid_by: EMAIL_LIKE_SCHEMA,
  source: SOURCE_SCHEMA,
  photo_url: z.string().nullable().optional(),
  photo_path: z.string().nullable().optional(),
  merchant_order_id: z.string().nullable().optional(),
  raw_ocr_json: z.string().max(45_000).nullable().optional(),
  note: z.string().nullable().optional(),
  time: ISO_TIME_INPUT_SCHEMA.nullable().optional(),
});
export type ReceiptInput = z.infer<typeof ReceiptInputSchema>;

export const ItemInputSchema = z.object({
  ...ProductClassificationSchema.shape,
  receipt_id: ULID_SCHEMA,
  product_id: ULID_SCHEMA.nullable().optional(),
  product_name: z.string().min(1),
  raw_product_name: z.string().min(1).optional(),
  store_product_code: z.string().nullable().optional(),
  product_url: z.string().nullable().optional(),
  product_image_url: z.string().nullable().optional(),
  category: z.string().min(1),
  qty: z.number().finite().positive(),
  unit_price_orig: z.number().finite(),
  fx_rate_eur: z.number().finite().positive(),
  consumed_by: CONSUMED_BY_SCHEMA,
  note: z.string().nullable().optional(),
  wasted_qty: z.number().finite().nonnegative().optional(),
  wasted_at: ISO_DATETIME_SCHEMA.nullable().optional(),
  discount_orig: z.number().finite().nonnegative().optional(),
});
export type ItemInput = z.infer<typeof ItemInputSchema>;

export const ProductInputSchema = z.object({
  ...ProductClassificationSchema.shape,
  brand: z.string().trim().min(1).nullable().optional(),
  is_organic: z.boolean().nullable().optional(),
  name: z.string().min(1),
  store: z.string().min(1),
  store_product_code: z.string().nullable().optional(),
  category: z.string().min(1),
  unit: PRODUCT_UNIT_SCHEMA.nullable().optional(),
  unit_size: z.number().finite().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type ProductInput = z.infer<typeof ProductInputSchema>;

export const ProductPriceInputSchema = z.object({
  product_id: ULID_SCHEMA,
  receipt_id: ULID_SCHEMA,
  price_orig: z.number().finite(),
  price_net: z.number().finite(),
  currency: ISO_4217_CURRENCY_SCHEMA,
  date: ISO_DATE_SCHEMA,
});
export type ProductPriceInput = z.infer<typeof ProductPriceInputSchema>;

// ── PackagedProduct (Пакований товар) ───────────────────────────────────────
// A store-agnostic physical product identified by its packaging. `products`
// stays the per-store receipt label and points here via packaged_product_id.
// See ADR-0027.

export const NUTRITION_BASIS_SCHEMA = z.enum(NUTRITION_BASES);
export const EU_ALLERGEN_SCHEMA = z.enum(EU_ALLERGENS);
export const NUTRI_SCORE_SCHEMA = z.enum(NUTRI_SCORES);
export const PACKAGED_PRODUCT_PHOTO_KIND_SCHEMA = z.enum(PACKAGED_PRODUCT_PHOTO_KINDS);
export const PACKAGED_PRODUCT_IMPORT_SOURCE_SCHEMA = z.enum(PACKAGED_PRODUCT_IMPORT_SOURCES);

// Format only. The GTIN check digit is advisory and lives in the UI, because
// in-store weight-embedded codes legitimately fail it. See ADR-0027.
export const BARCODE_SCHEMA = z.string().regex(/^[0-9]{8,14}$/, 'Barcode must be 8-14 digits');

const GRAM_NUTRIENT_SCHEMA = z.number().finite().min(0).max(100).nullable();

const PACKAGED_PRODUCT_NUTRITION_SHAPE = {
  nutrition_basis: NUTRITION_BASIS_SCHEMA.nullable(),
  energy_kj: z.number().finite().min(0).max(5000).nullable(),
  energy_kcal: z.number().finite().min(0).max(1200).nullable(),
  fat_g: GRAM_NUTRIENT_SCHEMA,
  saturated_fat_g: GRAM_NUTRIENT_SCHEMA,
  carbohydrate_g: GRAM_NUTRIENT_SCHEMA,
  sugars_g: GRAM_NUTRIENT_SCHEMA,
  fibre_g: GRAM_NUTRIENT_SCHEMA,
  protein_g: GRAM_NUTRIENT_SCHEMA,
  salt_g: GRAM_NUTRIENT_SCHEMA,
};

type PackagedProductInvariantInput = {
  nutrition_basis: string | null;
  energy_kj: number | null;
  energy_kcal: number | null;
  fat_g: number | null;
  saturated_fat_g: number | null;
  carbohydrate_g: number | null;
  sugars_g: number | null;
  fibre_g: number | null;
  protein_g: number | null;
  salt_g: number | null;
  package_size: number | null;
  package_unit: string | null;
};

// The 0.05 slack mirrors the CHECK constraints: it absorbs per-column rounding
// on the printed label, not transcription errors.
const LABEL_ROUNDING_SLACK = 0.05;

/**
 * Mirrors the CHECK constraints in 20260912072149_packaged_products.sql so a
 * violation surfaces as a readable issue before the round-trip to Postgres.
 */
export function addPackagedProductInvariantIssues(
  value: PackagedProductInvariantInput,
  ctx: z.RefinementCtx,
): void {
  const nutrients = [
    value.energy_kj,
    value.energy_kcal,
    value.fat_g,
    value.saturated_fat_g,
    value.carbohydrate_g,
    value.sugars_g,
    value.fibre_g,
    value.protein_g,
    value.salt_g,
  ];
  if (value.nutrition_basis == null && nutrients.some((n) => n != null)) {
    ctx.addIssue({
      code: 'custom',
      message: 'nutrition_basis is required when any nutrient value is present',
      path: ['nutrition_basis'],
    });
  }
  if (
    value.saturated_fat_g != null &&
    value.fat_g != null &&
    value.saturated_fat_g > value.fat_g + LABEL_ROUNDING_SLACK
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'saturated_fat_g cannot exceed fat_g',
      path: ['saturated_fat_g'],
    });
  }
  if (
    value.sugars_g != null &&
    value.carbohydrate_g != null &&
    value.sugars_g > value.carbohydrate_g + LABEL_ROUNDING_SLACK
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'sugars_g cannot exceed carbohydrate_g',
      path: ['sugars_g'],
    });
  }
  if ((value.package_size == null) !== (value.package_unit == null)) {
    ctx.addIssue({
      code: 'custom',
      message: 'package_size and package_unit must be set together',
      path: ['package_unit'],
    });
  }
}

export const PackagedProductSchema = z
  .object({
    ...ProductClassificationSchema.shape,
    ...PACKAGED_PRODUCT_NUTRITION_SHAPE,
    id: ULID_SCHEMA,
    name: z.string().trim().min(1, 'name is required'),
    brand: z.string().trim().min(1).nullable(),
    barcode: BARCODE_SCHEMA.nullable(),
    category: z.string().min(1, 'category is required'),
    is_organic: z.boolean().nullable(),
    package_size: z.number().finite().positive().nullable(),
    package_unit: PRODUCT_UNIT_SCHEMA.nullable(),
    package_count: z.number().int().positive().nullable(),
    serving_size: z.number().finite().positive().nullable(),
    nutri_score: NUTRI_SCORE_SCHEMA.nullable(),
    allergens: z.array(EU_ALLERGEN_SCHEMA),
    allergen_traces: z.array(EU_ALLERGEN_SCHEMA),
    ingredients_text: z.string().nullable(),
    notes: z.string().nullable(),
    import_source: PACKAGED_PRODUCT_IMPORT_SOURCE_SCHEMA,
    raw_import_json: z.unknown().nullable(),
    created_at: ISO_DATETIME_SCHEMA,
    updated_at: ISO_DATETIME_SCHEMA,
  })
  .superRefine((value, ctx) => {
    if (!ProductClassificationSchema.safeParse(value).success) {
      ctx.addIssue({
        code: 'custom',
        message: 'A product variant requires a family',
        path: ['product_variant_id'],
      });
    }
    addPackagedProductInvariantIssues(value, ctx);
  });
export type PackagedProduct = z.infer<typeof PackagedProductSchema>;

export const PackagedProductPhotoSchema = z.object({
  id: ULID_SCHEMA,
  packaged_product_id: ULID_SCHEMA,
  storage_path: z.string().trim().min(1),
  kind: PACKAGED_PRODUCT_PHOTO_KIND_SCHEMA,
  content_type: z.string().nullable(),
  byte_size: z.number().int().positive().nullable(),
  sort_order: z.number().int(),
  note: z.string().nullable(),
  created_at: ISO_DATETIME_SCHEMA,
  updated_at: ISO_DATETIME_SCHEMA,
});
export type PackagedProductPhoto = z.infer<typeof PackagedProductPhotoSchema>;

export const PackagedProductInputSchema = z.object({
  ...ProductClassificationSchema.shape,
  name: z.string().min(1),
  category: z.string().min(1),
  brand: z.string().nullable().optional(),
  barcode: z.string().nullable().optional(),
  is_organic: z.boolean().nullable().optional(),
  package_size: z.number().finite().nullable().optional(),
  package_unit: PRODUCT_UNIT_SCHEMA.nullable().optional(),
  package_count: z.number().finite().nullable().optional(),
  serving_size: z.number().finite().nullable().optional(),
  nutrition_basis: NUTRITION_BASIS_SCHEMA.nullable().optional(),
  energy_kj: z.number().finite().nullable().optional(),
  energy_kcal: z.number().finite().nullable().optional(),
  fat_g: z.number().finite().nullable().optional(),
  saturated_fat_g: z.number().finite().nullable().optional(),
  carbohydrate_g: z.number().finite().nullable().optional(),
  sugars_g: z.number().finite().nullable().optional(),
  fibre_g: z.number().finite().nullable().optional(),
  protein_g: z.number().finite().nullable().optional(),
  salt_g: z.number().finite().nullable().optional(),
  nutri_score: NUTRI_SCORE_SCHEMA.nullable().optional(),
  allergens: z.array(EU_ALLERGEN_SCHEMA).optional(),
  allergen_traces: z.array(EU_ALLERGEN_SCHEMA).optional(),
  ingredients_text: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  import_source: PACKAGED_PRODUCT_IMPORT_SOURCE_SCHEMA.optional(),
  raw_import_json: z.unknown().nullable().optional(),
});
export type PackagedProductInput = z.infer<typeof PackagedProductInputSchema>;

export const PackagedProductPhotoInputSchema = z.object({
  packaged_product_id: ULID_SCHEMA,
  storage_path: z.string().trim().min(1),
  kind: PACKAGED_PRODUCT_PHOTO_KIND_SCHEMA.optional(),
  content_type: z.string().nullable().optional(),
  byte_size: z.number().finite().nullable().optional(),
  sort_order: z.number().finite().optional(),
  note: z.string().nullable().optional(),
});
export type PackagedProductPhotoInput = z.infer<typeof PackagedProductPhotoInputSchema>;

// ── PackagedProductImport (external AI output) ──────────────────────────────
// The contract an external ChatGPT session produces today and a future Edge
// Function must produce too. Deliberately looser than PackagedProductSchema, in
// the same spirit as ParsedReceiptSchema: enum-ish fields arrive as free text and
// are normalized by `packagedProductFromImport`, and `category` is NOT checked
// against the categories table here — the dialog does that against live data so
// it can show which value was wrong.

/** German labels print "31,0"; some models pass numbers through as strings. */
const LOOSE_NUMBER_SCHEMA = z
  .union([z.number(), z.string()])
  .nullable()
  .optional()
  .transform((value, ctx) => {
    if (value == null) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const trimmed = value.trim();
    if (trimmed === '') return null;
    // "< 0,5" is a printed upper bound; the prompt asks for the bare number, but
    // accept the bound rather than losing the row over a leading glyph.
    const parsed = Number(trimmed.replace(/^[<≈~]\s*/, '').replace(',', '.'));
    if (!Number.isFinite(parsed)) {
      ctx.addIssue({ code: 'custom', message: `Expected a number, received "${value}"` });
      return null;
    }
    return parsed;
  });

const LOOSE_TEXT_SCHEMA = z.union([z.string(), z.number()]).nullable().optional();

export const PackagedProductImportSchema = z.object({
  name: z.string().trim().min(1, 'name is required'),
  brand: z.string().nullable().optional(),
  barcode: LOOSE_TEXT_SCHEMA,
  category: z.string().trim().min(1, 'category is required'),
  product_family_id: z.string().nullable().optional(),
  product_variant_id: z.string().nullable().optional(),
  is_organic: z.boolean().nullable().optional(),
  package_size: LOOSE_NUMBER_SCHEMA,
  package_unit: z.string().nullable().optional(),
  package_count: LOOSE_NUMBER_SCHEMA,
  serving_size: LOOSE_NUMBER_SCHEMA,
  nutrition_basis: z.string().nullable().optional(),
  energy_kj: LOOSE_NUMBER_SCHEMA,
  energy_kcal: LOOSE_NUMBER_SCHEMA,
  fat_g: LOOSE_NUMBER_SCHEMA,
  saturated_fat_g: LOOSE_NUMBER_SCHEMA,
  carbohydrate_g: LOOSE_NUMBER_SCHEMA,
  sugars_g: LOOSE_NUMBER_SCHEMA,
  fibre_g: LOOSE_NUMBER_SCHEMA,
  protein_g: LOOSE_NUMBER_SCHEMA,
  salt_g: LOOSE_NUMBER_SCHEMA,
  nutri_score: z.string().nullable().optional(),
  allergens: z.array(z.string()).nullable().optional(),
  allergen_traces: z.array(z.string()).nullable().optional(),
  ingredients_text: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type PackagedProductImport = z.infer<typeof PackagedProductImportSchema>;
