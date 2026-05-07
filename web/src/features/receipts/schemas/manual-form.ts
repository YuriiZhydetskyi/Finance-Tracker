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

const ItemFormSchema = z.object({
  product_id: ULID_SCHEMA.nullable().optional(),
  product_name: z.string().min(1, "Назва товару обов'язкова"),
  category: z.string().min(1, "Категорія обов'язкова"),
  qty: z.number().finite().positive('Кількість має бути більша 0'),
  unit_price_orig: z.number().finite(),
  consumed_by: CONSUMED_BY_SCHEMA,
  note: z.string().nullable().optional(),
  wasted_qty: z.number().finite().nonnegative().optional(),
  discount_orig: z.number().finite().nonnegative().optional(),
});
export type ItemFormValues = z.infer<typeof ItemFormSchema>;

export const ManualFormSchema = z.object({
  date: ISO_DATE_SCHEMA,
  store: z.string().min(1, "Магазин обов'язковий"),
  currency: z.enum(SUPPORTED_CURRENCIES),
  paid_by: EMAIL_LIKE_SCHEMA,
  source: SOURCE_SCHEMA,
  note: z.string().nullable().optional(),
  photo_url: z.string().nullable().optional(),
  raw_ocr_json: z.string().nullable().optional(),
  items: z.array(ItemFormSchema).min(1, 'Додай хоча б один товар'),
});
export type ManualFormValues = z.infer<typeof ManualFormSchema>;
