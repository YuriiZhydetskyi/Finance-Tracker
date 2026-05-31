// Authoritative Zod schemas — single source of truth for both runtime validation
// and TypeScript types (via z.infer). Mirrors docs/data-model.md.
//
// Schemas are vendor-free (no React, no Supabase). They're imported by:
//   - the React client (hooks, forms, optimistic updates)
//   - the Supabase Edge Function `parse-receipt` (post-AI validation)

import { z } from 'zod';
import { isValidConsumedBy } from './consumed-by';
import { ULID_REGEX } from './ulid';

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
export const SOURCE_SCHEMA = z.enum(['photo', 'manual', 'edit', 'manual-json']);
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
    product_name: z.string().min(1, 'product_name is required'),
    store_product_code: z.string().nullable(),
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

export const ProductSchema = z.object({
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
  discount_orig: z.number().finite().nonnegative().optional(),
  // Optional + nullable: not every receipt has per-line codes (e.g. Aldi yes,
  // many corner shops no). Optional preserves backward compat for raw_ocr_json
  // snapshots written before this field existed.
  product_code: z.string().nullable().optional(),
});
export type ParsedItem = z.infer<typeof ParsedItemSchema>;

export const ParsedReceiptSchema = z.object({
  store: z.string().nullable(),
  store_address: z.string().nullable().optional(),
  date: ISO_DATE_SCHEMA.nullable(),
  time: ISO_TIME_INPUT_SCHEMA.nullable().optional(),
  currency: ISO_4217_CURRENCY_SCHEMA,
  total_orig: z.number().finite().nullable(),
  items: z.array(ParsedItemSchema),
});
export type ParsedReceipt = z.infer<typeof ParsedReceiptSchema>;

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
  raw_ocr_json: z.string().max(45_000).nullable().optional(),
  note: z.string().nullable().optional(),
  time: ISO_TIME_INPUT_SCHEMA.nullable().optional(),
});
export type ReceiptInput = z.infer<typeof ReceiptInputSchema>;

export const ItemInputSchema = z.object({
  receipt_id: ULID_SCHEMA,
  product_id: ULID_SCHEMA.nullable().optional(),
  product_name: z.string().min(1),
  store_product_code: z.string().nullable().optional(),
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
