// Factories — the only sanctioned way to construct Receipts, Items, Products.
// Each factory generates a ULID id, sets created_at/updated_at, rounds money
// per the precision contract (money.ts), computes derived fields (total_eur,
// total_orig from qty * (unit_price_orig - discount_orig)), and validates
// against the corresponding schema.
//
// Storage / API layers must NOT round, parse consumed_by, or generate IDs
// themselves — they go through these factories.

import { roundFxRate, roundMoney, roundQty } from './money';
import { nowIso } from './time';
import { ulid } from './ulid';

// Normalize a time-of-day input (HH:MM or HH:MM:SS, possibly null/undefined/'')
// into the canonical HH:MM:SS string stored on Receipt. Empty string → null
// because `<input type="time">` returns '' when cleared.
function normalizeTime(input: string | null | undefined): string | null {
  if (input == null || input === '') return null;
  return /^\d{2}:\d{2}$/.test(input) ? `${input}:00` : input;
}
import { statementDedupKey } from './bank-statement';
import { normalizeStoreName } from './store-match';
import {
  ItemSchema,
  ProductPriceSchema,
  ProductSchema,
  ReceiptSchema,
  StatementTransactionSchema,
  StoreAliasSchema,
  type Item,
  type ItemInput,
  type Product,
  type ProductInput,
  type ProductPrice,
  type ProductPriceInput,
  type Receipt,
  type ReceiptInput,
  type StatementTransaction,
  type StatementTransactionInput,
  type StoreAlias,
  type StoreAliasInput,
} from './schemas';

export function makeReceipt(input: ReceiptInput): Receipt {
  const total_orig = roundMoney(input.total_orig);
  const fx_rate_eur = roundFxRate(input.fx_rate_eur);
  const total_eur = roundMoney(total_orig * fx_rate_eur);
  const now = nowIso();
  const candidate: Receipt = {
    id: ulid(),
    date: input.date,
    store: input.store,
    store_address: input.store_address ?? null,
    currency: input.currency,
    total_orig,
    fx_rate_eur,
    total_eur,
    paid_by: input.paid_by,
    photo_url: input.photo_url ?? null,
    photo_path: input.photo_path ?? null,
    source: input.source,
    raw_ocr_json: input.raw_ocr_json ?? null,
    note: input.note ?? null,
    time: normalizeTime(input.time),
    created_at: now,
    updated_at: now,
  };
  return ReceiptSchema.parse(candidate);
}

export function makeItem(input: ItemInput): Item {
  const qty = roundQty(input.qty);
  const unit_price_orig = roundMoney(input.unit_price_orig);
  const discount_orig = roundMoney(input.discount_orig ?? 0);
  const total_orig = roundMoney(qty * (unit_price_orig - discount_orig));
  const total_eur = roundMoney(total_orig * input.fx_rate_eur);
  const wasted_qty = roundQty(input.wasted_qty ?? 0);
  const now = nowIso();
  // Mirror the column invariant from schemas.ts: wasted_at present iff
  // wasted_qty > 0. If caller provided a value, trust it; otherwise default
  // to now() for newly-wasted items and null for clean ones.
  const wasted_at = wasted_qty > 0 ? (input.wasted_at ?? now) : null;
  const candidate: Item = {
    id: ulid(),
    receipt_id: input.receipt_id,
    product_id: input.product_id ?? null,
    product_name: input.product_name,
    store_product_code: input.store_product_code ?? null,
    category: input.category,
    qty,
    unit_price_orig,
    total_orig,
    total_eur,
    consumed_by: input.consumed_by,
    note: input.note ?? null,
    wasted_qty,
    wasted_at,
    discount_orig,
    created_at: now,
    updated_at: now,
  };
  return ItemSchema.parse(candidate);
}

export function makeProduct(input: ProductInput): Product {
  const now = nowIso();
  const candidate: Product = {
    id: ulid(),
    name: input.name,
    store: input.store,
    store_product_code: input.store_product_code ?? null,
    category: input.category,
    unit: input.unit ?? null,
    unit_size: typeof input.unit_size === 'number' ? input.unit_size : null,
    notes: input.notes ?? null,
    created_at: now,
    updated_at: now,
  };
  return ProductSchema.parse(candidate);
}

export function makeProductPrice(input: ProductPriceInput): ProductPrice {
  const now = nowIso();
  const candidate: ProductPrice = {
    id: ulid(),
    product_id: input.product_id,
    receipt_id: input.receipt_id,
    price_orig: roundMoney(input.price_orig),
    price_net: roundMoney(input.price_net),
    currency: input.currency,
    date: input.date,
    created_at: now,
  };
  return ProductPriceSchema.parse(candidate);
}

export function makeStatementTransaction(input: StatementTransactionInput): StatementTransaction {
  const amount_orig = roundMoney(input.amount_orig);
  const merchant = input.merchant ?? null;
  const raw = input.raw ?? null;
  const now = nowIso();
  const candidate: StatementTransaction = {
    id: ulid(),
    date: input.date,
    time: normalizeTime(input.time),
    amount_orig,
    currency: input.currency,
    merchant,
    raw,
    paid_by: input.paid_by,
    status: 'unmatched',
    receipt_id: null,
    suggested_category: input.suggested_category ?? null,
    dedup_key: statementDedupKey(
      input.date,
      amount_orig,
      input.currency,
      merchant,
      raw,
      input.occurrence ?? 0,
    ),
    created_at: now,
    updated_at: now,
  };
  return StatementTransactionSchema.parse(candidate);
}

export function makeStoreAlias(input: StoreAliasInput): StoreAlias {
  const candidate: StoreAlias = {
    id: ulid(),
    statement_name: normalizeStoreName(input.statement_name),
    receipt_store: normalizeStoreName(input.receipt_store),
    created_at: nowIso(),
  };
  return StoreAliasSchema.parse(candidate);
}

// ── Patch helpers (UPDATE) ──────────────────────────────────────────────────
// Each merges the patch onto the existing entity, rounds and recomputes
// derived numbers, bumps updated_at, validates the result.

export type ReceiptPatch = Partial<
  Pick<
    Receipt,
    | 'date'
    | 'store'
    | 'store_address'
    | 'currency'
    | 'total_orig'
    | 'fx_rate_eur'
    | 'paid_by'
    | 'photo_url'
    | 'photo_path'
    | 'source'
    | 'raw_ocr_json'
    | 'note'
    | 'time'
  >
>;

export function applyReceiptPatch(existing: Receipt, patch: ReceiptPatch): Receipt {
  const merged: Receipt = { ...existing, ...patch };
  if (patch.total_orig !== undefined) merged.total_orig = roundMoney(patch.total_orig);
  if (patch.fx_rate_eur !== undefined) merged.fx_rate_eur = roundFxRate(patch.fx_rate_eur);
  if (patch.time !== undefined) merged.time = normalizeTime(patch.time);
  merged.total_eur = roundMoney(merged.total_orig * merged.fx_rate_eur);
  merged.updated_at = nowIso();
  return ReceiptSchema.parse(merged);
}

export type ItemPatch = Partial<
  Pick<
    Item,
    | 'product_id'
    | 'product_name'
    | 'store_product_code'
    | 'category'
    | 'qty'
    | 'unit_price_orig'
    | 'consumed_by'
    | 'note'
    | 'wasted_qty'
    | 'wasted_at'
    | 'discount_orig'
  >
>;

export function applyItemPatch(existing: Item, patch: ItemPatch, parentFxRate: number): Item {
  const merged: Item = { ...existing, ...patch };
  if (patch.qty !== undefined) merged.qty = roundQty(patch.qty);
  if (patch.unit_price_orig !== undefined)
    merged.unit_price_orig = roundMoney(patch.unit_price_orig);
  if (patch.wasted_qty !== undefined) merged.wasted_qty = roundQty(patch.wasted_qty);
  if (patch.discount_orig !== undefined) merged.discount_orig = roundMoney(patch.discount_orig);
  merged.total_orig = roundMoney(merged.qty * (merged.unit_price_orig - merged.discount_orig));
  merged.total_eur = roundMoney(merged.total_orig * parentFxRate);
  merged.updated_at = nowIso();
  // Enforce wasted_at ↔ wasted_qty invariant: if patch changed wasted_qty
  // without also setting wasted_at, derive it. Explicit wasted_at in the
  // patch takes precedence (caller knows best).
  if (patch.wasted_qty !== undefined && patch.wasted_at === undefined) {
    merged.wasted_at = merged.wasted_qty > 0 ? (existing.wasted_at ?? merged.updated_at) : null;
  }
  return ItemSchema.parse(merged);
}
