import { describe, expect, it } from 'vitest';
import { PackagedProductImportSchema, type PackagedProductImport } from '@finance-tracker/domain';
import { toPackagedProductCandidates } from './packaged-product-candidates';
import {
  validatePackagedProductImport,
  type ImportValidationContext,
} from './validate-packaged-product-import';

const BASE = {
  name: 'Pringles Original 165 г',
  brand: 'Pringles',
  barcode: '5053990101658',
  category: 'Снеки',
  product_family_id: 'chips',
  product_variant_id: 'potato_chips',
  is_organic: false,
  package_size: 165,
  package_unit: 'g',
  serving_size: 30,
  nutrition_basis: 'per_100_g',
  energy_kj: 2180,
  energy_kcal: 523,
  fat_g: 31,
  saturated_fat_g: 2.9,
  carbohydrate_g: 52,
  sugars_g: 2.4,
  fibre_g: 3.1,
  protein_g: 4.2,
  salt_g: 1.3,
  nutri_score: 'D',
  allergens: ['gluten'],
  allergen_traces: [],
  ingredients_text: 'Kartoffelflocken, Maismehl',
};

function parsed(overrides: Record<string, unknown> = {}): PackagedProductImport {
  const result = PackagedProductImportSchema.safeParse({ ...BASE, ...overrides });
  if (!result.success) throw new Error(JSON.stringify(result.error.issues));
  return result.data;
}

function context(overrides: Partial<ImportValidationContext> = {}): ImportValidationContext {
  return {
    categories: ['Снеки', 'Інше', 'Хімія/гігієна'],
    families: [{ id: 'chips' }, { id: 'milk' }],
    variants: [{ id: 'potato_chips', family_id: 'chips' }],
    existingByBarcode: new Map(),
    existingNamesWithoutBarcode: new Map(),
    ...overrides,
  };
}

describe('validatePackagedProductImport', () => {
  it('accepts a clean payload with no errors or warnings', () => {
    expect(validatePackagedProductImport(parsed(), context())).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it('rejects a category the app does not have', () => {
    const { errors } = validatePackagedProductImport(parsed({ category: 'Вигадана' }), context());
    expect(errors).toEqual([expect.stringContaining('Вигадана')]);
  });

  it('rejects a variant that belongs to another family', () => {
    const { errors } = validatePackagedProductImport(
      parsed({ product_family_id: 'milk', product_variant_id: 'potato_chips' }),
      context(),
    );
    expect(errors).toEqual([expect.stringContaining('належить сімейству "chips"')]);
  });

  it('rejects a barcode another card already owns', () => {
    const { errors } = validatePackagedProductImport(
      parsed(),
      context({
        existingByBarcode: new Map([
          ['5053990101658', { id: '01J', name: 'Pringles Original стара картка' }],
        ]),
      }),
    );
    expect(errors).toEqual([expect.stringContaining('вже має картка')]);
  });

  it('mirrors the name-without-barcode unique index', () => {
    const { errors } = validatePackagedProductImport(
      parsed({ barcode: null }),
      context({
        existingNamesWithoutBarcode: new Map([
          ['pringles original 165 г', { id: '01J', name: 'Pringles Original 165 г' }],
        ]),
      }),
    );
    expect(errors).toEqual([expect.stringContaining('уже існує')]);
  });

  it('warns about a bad GTIN check digit without blocking', () => {
    const result = validatePackagedProductImport(parsed({ barcode: '5053990101659' }), context());
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([expect.stringContaining('контрольна цифра')]);
  });

  it('blocks nutrients whose printed column is unknown', () => {
    const { errors } = validatePackagedProductImport(
      parsed({ nutrition_basis: 'per serving' }),
      context(),
    );
    expect(errors).toEqual([
      expect.stringContaining('не розпізнана'),
      expect.stringContaining('з якої колонки етикетки'),
    ]);
  });

  it('warns when a food product carries no nutrition at all', () => {
    const result = validatePackagedProductImport(
      parsed({
        nutrition_basis: null,
        energy_kj: null,
        energy_kcal: null,
        fat_g: null,
        saturated_fat_g: null,
        carbohydrate_g: null,
        sugars_g: null,
        fibre_g: null,
        protein_g: null,
        salt_g: null,
      }),
      context(),
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([expect.stringContaining('немає харчової цінності')]);
  });

  it('stays quiet about missing nutrition for a non-food category', () => {
    const result = validatePackagedProductImport(
      parsed({
        category: 'Хімія/гігієна',
        product_family_id: null,
        product_variant_id: null,
        nutrition_basis: null,
        energy_kj: null,
        energy_kcal: null,
        fat_g: null,
        saturated_fat_g: null,
        carbohydrate_g: null,
        sugars_g: null,
        fibre_g: null,
        protein_g: null,
        salt_g: null,
        ingredients_text: null,
      }),
      context(),
    );
    expect(result).toEqual({ errors: [], warnings: [] });
  });

  it('warns about allergens outside the EU list', () => {
    const result = validatePackagedProductImport(
      parsed({ allergens: ['gluten', 'kiwi'] }),
      context(),
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([expect.stringContaining('kiwi')]);
  });

  it('rejects a package size without a unit', () => {
    const { errors } = validatePackagedProductImport(parsed({ package_unit: null }), context());
    expect(errors).toEqual([expect.stringContaining('разом')]);
  });
});

describe('toPackagedProductCandidates', () => {
  it('accepts a bare object', () => {
    expect(toPackagedProductCandidates({ name: 'a' })).toEqual([{ name: 'a' }]);
  });

  it('accepts a top-level array', () => {
    expect(toPackagedProductCandidates([{ name: 'a' }, { name: 'b' }])).toHaveLength(2);
  });

  it('unwraps products / packaged_products / items', () => {
    expect(toPackagedProductCandidates({ products: [{ name: 'a' }] })).toEqual([{ name: 'a' }]);
    expect(toPackagedProductCandidates({ packaged_products: [{ name: 'b' }] })).toEqual([
      { name: 'b' },
    ]);
    expect(toPackagedProductCandidates({ items: [{ name: 'c' }] })).toEqual([{ name: 'c' }]);
  });

  it('unwraps a singular product wrapper', () => {
    expect(toPackagedProductCandidates({ product: { name: 'a' } })).toEqual([{ name: 'a' }]);
  });
});
