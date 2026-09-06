// Zod schema for the /manual form. Mirrors what useSaveReceiptMutation accepts:
//   - SaveReceiptInput (= ReceiptInput without fx_rate_eur and total_orig)
//   - SaveItemInput[] (= ItemInput[] without fx_rate_eur and receipt_id)
//
// Currency is narrowed to the supported set (EUR/UAH) at the form layer so the
// dropdown can't produce values that Fx provider would reject.

import { z } from 'zod';
import {
  CONSUMED_BY_SCHEMA,
  EMAIL_LIKE_SCHEMA,
  ISO_DATE_SCHEMA,
  SOURCE_SCHEMA,
  ULID_SCHEMA,
} from '@finance-tracker/domain';

export const SUPPORTED_CURRENCIES = ['EUR', 'UAH'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

// pair_marker is a UI-only hint produced by detectPairs() and read by ItemRow
// to render a "Пробито випадково" / "Знижка · автоматично згруповано" /
// "Згруповано N рядків" badge. Never persisted to the DB: PhotoReviewForm
// strips it before insert. `count` reflects how many input rows merged into
// this one (1 for plain pair without aggregation; ≥2 when Pass 3 fired).
const PairMarkerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cancelled'), count: z.number().int().positive() }),
  z.object({ kind: z.literal('discount-merged'), count: z.number().int().positive() }),
  z.object({ kind: z.literal('aggregated'), count: z.number().int().min(2) }),
]);

const ItemFormSchema = z.object({
  product_id: ULID_SCHEMA.nullable().optional(),
  product_name: z.string().min(1, "Назва товару обов'язкова"),
  store_product_code: z.string().nullable().optional(),
  product_url: z.string().nullable().optional(),
  product_image_url: z.string().nullable().optional(),
  category: z.string().min(1, "Категорія обов'язкова"),
  qty: z.number().finite().positive('Кількість має бути більша 0'),
  unit_price_orig: z.number().finite(),
  consumed_by: CONSUMED_BY_SCHEMA,
  note: z.string().nullable().optional(),
  wasted_qty: z.number().finite().nonnegative().optional(),
  // Carried through edit flow as a pass-through so /edit doesn't reset the
  // "last wasted at" timestamp of items that already had spoilage logged.
  // Set/cleared on /waste, never edited here.
  wasted_at: z.string().nullable().optional(),
  discount_orig: z.number().finite().nonnegative().optional(),
  pair_marker: PairMarkerSchema.optional(),
});
export type ItemFormValues = z.infer<typeof ItemFormSchema>;

export const ManualFormSchema = z.object({
  date: ISO_DATE_SCHEMA,
  // Browser `<input type="time">` returns HH:MM (or '' when empty); the
  // setValueAs transform in ReceiptFormFields coerces '' → null before this
  // schema runs. Factory normalizes HH:MM → HH:MM:SS at save time.
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Час у форматі HH:MM')
    .nullable()
    .optional(),
  store: z.string().min(1, "Магазин обов'язковий"),
  store_address: z.string().nullable().optional(),
  currency: z.enum(SUPPORTED_CURRENCIES),
  paid_by: EMAIL_LIKE_SCHEMA,
  source: SOURCE_SCHEMA,
  note: z.string().nullable().optional(),
  photo_url: z.string().nullable().optional(),
  photo_path: z.string().nullable().optional(),
  merchant_order_id: z.string().nullable().optional(),
  raw_ocr_json: z.string().nullable().optional(),
  items: z.array(ItemFormSchema).min(1, 'Додай хоча б один товар'),
});
export type ManualFormValues = z.infer<typeof ManualFormSchema>;
