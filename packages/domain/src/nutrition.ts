// Nutrition vocabulary and helpers for packaged products (ADR-0027).
// Vendor-free: no Zod here, only the constants and pure functions that both the
// schemas and the UI need. Keeping the tuples here makes them the single ordered
// source that must agree with the Postgres enums.

/** Mirrors public.nutrition_basis. Values are never converted between bases. */
export const NUTRITION_BASES = ['per_100_g', 'per_100_ml'] as const;
export type NutritionBasis = (typeof NUTRITION_BASES)[number];

/**
 * Mirrors public.eu_allergen — the 14 allergens EU FIC 1169/2011 requires to be
 * declared. Order matters: it must match the Postgres enum so a future
 * `alter type ... add value` is visibly a change on both sides.
 */
export const EU_ALLERGENS = [
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'peanuts',
  'soybeans',
  'milk',
  'nuts',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
  'molluscs',
] as const;
export type EuAllergen = (typeof EU_ALLERGENS)[number];

export const NUTRI_SCORES = ['A', 'B', 'C', 'D', 'E'] as const;
export type NutriScore = (typeof NUTRI_SCORES)[number];

/** Mirrors public.packaged_product_photos.kind. */
export const PACKAGED_PRODUCT_PHOTO_KINDS = [
  'front',
  'back',
  'nutrition',
  'ingredients',
  'barcode',
  'source_pdf',
  'other',
] as const;
export type PackagedProductPhotoKind = (typeof PACKAGED_PRODUCT_PHOTO_KINDS)[number];

/** Mirrors public.packaged_products.import_source. */
export const PACKAGED_PRODUCT_IMPORT_SOURCES = ['manual-json', 'manual', 'edge-function'] as const;
export type PackagedProductImportSource = (typeof PACKAGED_PRODUCT_IMPORT_SOURCES)[number];

/**
 * Every gram-valued nutrient column, in printed-label order. The factory and the
 * UI table both iterate this so the two can't drift apart.
 */
export const NUTRIENT_GRAM_KEYS = [
  'fat_g',
  'saturated_fat_g',
  'carbohydrate_g',
  'sugars_g',
  'fibre_g',
  'protein_g',
  'salt_g',
] as const;
export type NutrientGramKey = (typeof NUTRIENT_GRAM_KEYS)[number];

export const NUTRIENT_ENERGY_KEYS = ['energy_kj', 'energy_kcal'] as const;
export type NutrientEnergyKey = (typeof NUTRIENT_ENERGY_KEYS)[number];

/**
 * 3dp, matching numeric(6,3). Deliberately NOT roundQty: nutrition is neither
 * money nor quantity, and collapsing them would couple two unrelated invariants.
 */
export function roundNutrientGrams(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** 1dp, matching numeric(7,1)/numeric(8,1). Labels print integers; 1dp absorbs "52,5". */
export function roundEnergy(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Strips the spacing printed under a barcode ("5 053990 101658" -> "5053990101658"). */
export function normalizeBarcode(raw: string): string {
  return raw.replace(/[^0-9]/g, '');
}

/**
 * GTIN mod-10 check digit. ADVISORY ONLY — never a schema rule: in-store
 * weight-embedded codes (2xxxxxxxxxxx) and some private-label codes legitimately
 * fail it, and rejecting them would reject real products. The UI shows it as a
 * "re-read the digits" warning.
 */
export function isValidGtin(barcode: string): boolean {
  if (!/^[0-9]+$/.test(barcode)) return false;
  if (![8, 12, 13, 14].includes(barcode.length)) return false;

  const digits = [...barcode].map(Number);
  const check = digits.pop();
  if (check === undefined) return false;

  // Weights alternate 3,1,... reading right-to-left from the digit before the check.
  const sum = digits.reduceRight(
    (acc, digit, index) => acc + digit * ((digits.length - index) % 2 === 1 ? 3 : 1),
    0,
  );
  return (10 - (sum % 10)) % 10 === check;
}

export function normalizeAllergens(values: readonly string[]): EuAllergen[] {
  const allowed = new Set<string>(EU_ALLERGENS);
  const seen = new Set<EuAllergen>();
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (allowed.has(normalized)) seen.add(normalized as EuAllergen);
  }
  // Sorted by the canonical label order so equality checks and the UI are stable.
  return EU_ALLERGENS.filter((allergen) => seen.has(allergen));
}

// ── Label vocabulary normalizers ────────────────────────────────────────────
// An external AI transcribes what is printed, and printed labels are German,
// Ukrainian or English. These accept the spellings that actually come back and
// return null for anything unrecognised, so a bad value surfaces as a validation
// error rather than as silently wrong data.

const NUTRITION_BASIS_ALIASES: Record<string, NutritionBasis> = {
  per100g: 'per_100_g',
  per100gram: 'per_100_g',
  per100grams: 'per_100_g',
  per100ml: 'per_100_ml',
  per100milliliter: 'per_100_ml',
  per100millilitre: 'per_100_ml',
  pro100g: 'per_100_g',
  pro100ml: 'per_100_ml',
  na100g: 'per_100_g',
  na100ml: 'per_100_ml',
};

export function normalizeNutritionBasis(raw: string): NutritionBasis | null {
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  return NUTRITION_BASIS_ALIASES[key] ?? null;
}

const PACKAGE_UNIT_ALIASES: Record<string, PackageUnit> = {
  pcs: 'pcs',
  pc: 'pcs',
  piece: 'pcs',
  pieces: 'pcs',
  stk: 'pcs',
  stueck: 'pcs',
  штук: 'pcs',
  шт: 'pcs',
  g: 'g',
  gr: 'g',
  gram: 'g',
  gramm: 'g',
  grams: 'g',
  г: 'g',
  kg: 'kg',
  kilogram: 'kg',
  kilogramm: 'kg',
  кг: 'kg',
  ml: 'ml',
  milliliter: 'ml',
  millilitre: 'ml',
  мл: 'ml',
  l: 'l',
  liter: 'l',
  litre: 'l',
  л: 'l',
};

/** Mirrors public.product_unit. */
export type PackageUnit = 'pcs' | 'g' | 'kg' | 'ml' | 'l';

export function normalizePackageUnit(raw: string): PackageUnit | null {
  const key = raw.trim().toLowerCase().replace(/[.\s]/g, '').replace(/ü/g, 'ue');
  return PACKAGE_UNIT_ALIASES[key] ?? null;
}

export function normalizeNutriScore(raw: string): NutriScore | null {
  const key = raw.trim().toUpperCase();
  return (NUTRI_SCORES as readonly string[]).includes(key) ? (key as NutriScore) : null;
}
