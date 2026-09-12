// Cross-checks a parsed packaged-product payload against live app data.
//
// Split in two on purpose:
//   * errors   — block the whole paste. Anything that would be rejected by a DB
//                constraint, so the user reads a sentence instead of a Postgres
//                error code, plus the duplicate-barcode guard.
//   * warnings — never block. Transcription smells where the label itself may
//                legitimately be the odd one out.

import {
  EU_ALLERGENS,
  isValidGtin,
  normalizeBarcode,
  normalizeNutriScore,
  normalizeNutritionBasis,
  normalizePackageUnit,
  type PackagedProductImport,
} from '@finance-tracker/domain';

export type ImportValidationContext = {
  categories: string[];
  families: { id: string }[];
  variants: { id: string; family_id: string }[];
  /** Barcodes already in the catalogue, mapped to the card that owns them. */
  existingByBarcode: Map<string, { id: string; name: string }>;
  /** Normalized names of catalogue rows that have no barcode. */
  existingNamesWithoutBarcode: Map<string, { id: string; name: string }>;
};

export type ImportValidationResult = {
  errors: string[];
  warnings: string[];
};

export function normalizeCatalogueName(name: string): string {
  return name.trim().toLowerCase();
}

/** Categories where an absent nutrition table is worth flagging. */
const NON_FOOD_CATEGORIES = new Set([
  'Хімія/гігієна',
  'Одяг',
  'Електроніка',
  'Оренда житла',
  'Комуналка',
  'Авто',
  'Транспорт',
  'Розваги',
  'Курси/освіта',
  'Підписки',
  'Послуги',
  'Дім і ремонт',
  'Інтимні товари',
  'Pfand',
]);

export function validatePackagedProductImport(
  raw: PackagedProductImport,
  context: ImportValidationContext,
): ImportValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!context.categories.includes(raw.category)) {
    errors.push(`категорія "${raw.category}" не існує в застосунку`);
  }

  const familyId = raw.product_family_id ?? null;
  const variantId = raw.product_variant_id ?? null;
  if (familyId != null && !context.families.some((f) => f.id === familyId)) {
    errors.push(`сімейство товару "${familyId}" не існує`);
  }
  if (variantId != null) {
    const variant = context.variants.find((v) => v.id === variantId);
    if (!variant) errors.push(`варіант товару "${variantId}" не існує`);
    else if (variant.family_id !== familyId) {
      errors.push(
        `варіант "${variantId}" належить сімейству "${variant.family_id}", а не "${familyId ?? 'null'}"`,
      );
    }
  }

  const barcodeText = raw.barcode == null ? null : normalizeBarcode(String(raw.barcode));
  const barcode = barcodeText === '' ? null : barcodeText;
  if (barcode != null) {
    const taken = context.existingByBarcode.get(barcode);
    if (taken) errors.push(`штрихкод ${barcode} вже має картка "${taken.name}"`);
    else if (!isValidGtin(barcode)) {
      warnings.push(`контрольна цифра штрихкоду ${barcode} не збігається — перевір цифри`);
    }
  } else {
    const nameKey = normalizeCatalogueName(raw.name);
    const taken = context.existingNamesWithoutBarcode.get(nameKey);
    if (taken) {
      errors.push(
        `картка без штрихкоду з назвою "${taken.name}" уже існує — додай штрихкод або уточни назву`,
      );
    }
  }

  const unit = raw.package_unit?.trim() ?? null;
  if (unit != null && unit !== '' && normalizePackageUnit(unit) == null) {
    errors.push(`одиниця упаковки "${unit}" не розпізнана (очікується pcs, g, kg, ml або l)`);
  }
  if ((raw.package_size == null) !== (unit == null || unit === '')) {
    errors.push('package_size і package_unit мають бути заповнені разом');
  }

  const basis = raw.nutrition_basis?.trim() ?? null;
  const parsedBasis = basis == null || basis === '' ? null : normalizeNutritionBasis(basis);
  if (basis != null && basis !== '' && parsedBasis == null) {
    errors.push(`харчова основа "${basis}" не розпізнана — очікується per_100_g або per_100_ml`);
  }

  const score = raw.nutri_score?.trim() ?? null;
  if (score != null && score !== '' && normalizeNutriScore(score) == null) {
    errors.push(`Nutri-Score "${score}" не розпізнано — очікується літера A–E`);
  }

  const allowedAllergens = new Set<string>(EU_ALLERGENS);
  const dropped = [...(raw.allergens ?? []), ...(raw.allergen_traces ?? [])].filter(
    (value) => !allowedAllergens.has(value.trim().toLowerCase()),
  );
  if (dropped.length > 0) {
    warnings.push(
      `алергени поза списком EU і будуть відкинуті: ${[...new Set(dropped)].join(', ')}`,
    );
  }

  const hasNutrition = [
    raw.energy_kj,
    raw.energy_kcal,
    raw.fat_g,
    raw.saturated_fat_g,
    raw.carbohydrate_g,
    raw.sugars_g,
    raw.fibre_g,
    raw.protein_g,
    raw.salt_g,
  ].some((value) => value != null);

  if (parsedBasis == null && hasNutrition) {
    errors.push('є значення харчової цінності, але не вказано, з якої колонки етикетки вони взяті');
  }
  if (!hasNutrition && !NON_FOOD_CATEGORIES.has(raw.category)) {
    warnings.push('немає харчової цінності — перевір, чи сфотографовано зворот упаковки');
  }
  if (raw.ingredients_text == null || raw.ingredients_text.trim() === '') {
    if (!NON_FOOD_CATEGORIES.has(raw.category)) warnings.push('немає складу');
  }

  return { errors, warnings };
}
