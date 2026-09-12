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
import { ProductClassificationSchema } from './product-taxonomy';

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
  PackagedProductSchema,
  PackagedProductPhotoSchema,
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
  type PackagedProduct,
  type PackagedProductInput,
  type PackagedProductImport,
  type PackagedProductPhoto,
  type PackagedProductPhotoInput,
} from './schemas';
import {
  NUTRIENT_GRAM_KEYS,
  normalizeAllergens,
  normalizeBarcode,
  normalizeNutriScore,
  normalizeNutritionBasis,
  normalizePackageUnit,
  roundEnergy,
  roundNutrientGrams,
  type PackagedProductImportSource,
} from './nutrition';

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
    merchant_order_id: input.merchant_order_id ?? null,
    source: input.source,
    raw_ocr_json: input.raw_ocr_json ?? null,
    note: input.note ?? null,
    time: normalizeTime(input.time),
    created_at: now,
    updated_at: now,
  };
  return ReceiptSchema.parse(candidate);
}

export function makeItem(input: ItemInput): Item & {
  product_family_id: string | null;
  product_variant_id: string | null;
} {
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
    ...ProductClassificationSchema.parse(input),
    id: ulid(),
    receipt_id: input.receipt_id,
    product_id: input.product_id ?? null,
    product_name: input.product_name,
    // Imports and manual entry start with the entered receipt label. Historical
    // corrections can later change product_name without losing this evidence.
    raw_product_name: input.raw_product_name ?? input.product_name,
    store_product_code: input.store_product_code ?? null,
    product_url: input.product_url ?? null,
    product_image_url: input.product_image_url ?? null,
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
  const item = ItemSchema.parse(candidate);
  return {
    ...item,
    product_family_id: item.product_family_id ?? null,
    product_variant_id: item.product_variant_id ?? null,
  };
}

export function makeProduct(input: ProductInput): Product & {
  product_family_id: string | null;
  product_variant_id: string | null;
  brand: string | null;
  is_organic: boolean | null;
} {
  const now = nowIso();
  const candidate: Product = {
    ...ProductClassificationSchema.parse(input),
    ...(input.brand !== undefined ? { brand: input.brand } : {}),
    ...(input.is_organic !== undefined ? { is_organic: input.is_organic } : {}),
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
  const product = ProductSchema.parse(candidate);
  return {
    ...product,
    product_family_id: product.product_family_id ?? null,
    product_variant_id: product.product_variant_id ?? null,
    brand: product.brand ?? null,
    is_organic: product.is_organic ?? null,
  };
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
    | 'merchant_order_id'
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
    | 'product_url'
    | 'product_image_url'
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

// ── PackagedProduct (Пакований товар) ───────────────────────────────────────

function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function roundNullable(
  value: number | null | undefined,
  round: (n: number) => number,
): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? round(value) : null;
}

function positiveIntOrNull(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
}

// The classification keys are optional on the schema, but Postgres inserts under
// `exactOptionalPropertyTypes` reject `undefined` for a `string | null` column —
// the same widening makeProduct does for exactly the same reason.
export function makePackagedProduct(
  input: PackagedProductInput,
): PackagedProduct & { product_family_id: string | null; product_variant_id: string | null } {
  const now = nowIso();
  const barcode = trimToNull(input.barcode);
  const grams = Object.fromEntries(
    NUTRIENT_GRAM_KEYS.map((key) => [key, roundNullable(input[key], roundNutrientGrams)]),
  ) as Record<(typeof NUTRIENT_GRAM_KEYS)[number], number | null>;

  const candidate: PackagedProduct = {
    ...ProductClassificationSchema.parse(input),
    id: ulid(),
    name: input.name.trim(),
    brand: trimToNull(input.brand),
    barcode: barcode == null ? null : normalizeBarcode(barcode),
    category: input.category,
    is_organic: input.is_organic ?? null,
    package_size: roundNullable(input.package_size, roundQty),
    package_unit: input.package_unit ?? null,
    package_count: positiveIntOrNull(input.package_count),
    serving_size: roundNullable(input.serving_size, roundQty),
    nutrition_basis: input.nutrition_basis ?? null,
    energy_kj: roundNullable(input.energy_kj, roundEnergy),
    energy_kcal: roundNullable(input.energy_kcal, roundEnergy),
    ...grams,
    nutri_score: input.nutri_score ?? null,
    allergens: normalizeAllergens(input.allergens ?? []),
    allergen_traces: normalizeAllergens(input.allergen_traces ?? []),
    ingredients_text: trimToNull(input.ingredients_text),
    notes: trimToNull(input.notes),
    import_source: input.import_source ?? 'manual',
    raw_import_json: input.raw_import_json ?? null,
    created_at: now,
    updated_at: now,
  };

  const product = PackagedProductSchema.parse(candidate);
  return {
    ...product,
    product_family_id: product.product_family_id ?? null,
    product_variant_id: product.product_variant_id ?? null,
  };
}

export function makePackagedProductPhoto(input: PackagedProductPhotoInput): PackagedProductPhoto {
  const now = nowIso();
  const candidate: PackagedProductPhoto = {
    id: ulid(),
    packaged_product_id: input.packaged_product_id,
    storage_path: input.storage_path.trim(),
    kind: input.kind ?? 'other',
    content_type: trimToNull(input.content_type),
    byte_size: positiveIntOrNull(input.byte_size),
    sort_order: Math.round(input.sort_order ?? 0),
    note: trimToNull(input.note),
    created_at: now,
    updated_at: now,
  };
  return PackagedProductPhotoSchema.parse(candidate);
}

/**
 * Adapter from the external-AI contract to a persisted row. This is the seam:
 * a future parse-packaging Edge Function produces the same PackagedProductImport
 * shape and this function persists it, so only `import_source` differs.
 *
 * Free-text enum-ish fields are normalized here rather than in the schema so a
 * German "Gramm" or a lowercase nutri-score does not cost the user a whole paste.
 * A value that still cannot be understood becomes null and is then caught by
 * PackagedProductSchema (for example a nutrient without a basis).
 */
export function packagedProductFromImport(
  raw: PackagedProductImport,
  extras: { import_source: PackagedProductImportSource; raw_import_json?: unknown },
): ReturnType<typeof makePackagedProduct> {
  const barcodeText = raw.barcode == null ? null : String(raw.barcode);
  const barcode = barcodeText == null ? null : normalizeBarcode(barcodeText);
  const unit = trimToNull(raw.package_unit);
  const basis = trimToNull(raw.nutrition_basis);
  const score = trimToNull(raw.nutri_score);

  return makePackagedProduct({
    name: raw.name,
    category: raw.category,
    brand: raw.brand ?? null,
    barcode: barcode === '' ? null : barcode,
    product_family_id: raw.product_family_id ?? null,
    product_variant_id: raw.product_variant_id ?? null,
    is_organic: raw.is_organic ?? null,
    package_size: raw.package_size,
    package_unit: unit == null ? null : normalizePackageUnit(unit),
    package_count: raw.package_count,
    serving_size: raw.serving_size,
    nutrition_basis: basis == null ? null : normalizeNutritionBasis(basis),
    energy_kj: raw.energy_kj,
    energy_kcal: raw.energy_kcal,
    fat_g: raw.fat_g,
    saturated_fat_g: raw.saturated_fat_g,
    carbohydrate_g: raw.carbohydrate_g,
    sugars_g: raw.sugars_g,
    fibre_g: raw.fibre_g,
    protein_g: raw.protein_g,
    salt_g: raw.salt_g,
    nutri_score: score == null ? null : normalizeNutriScore(score),
    allergens: normalizeAllergens(raw.allergens ?? []),
    allergen_traces: normalizeAllergens(raw.allergen_traces ?? []),
    ingredients_text: raw.ingredients_text ?? null,
    notes: raw.notes ?? null,
    import_source: extras.import_source,
    raw_import_json: extras.raw_import_json ?? null,
  });
}
