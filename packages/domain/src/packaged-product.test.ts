import { describe, expect, it } from 'vitest';
import {
  makePackagedProduct,
  makePackagedProductPhoto,
  packagedProductFromImport,
} from './factories';
import { PackagedProductImportSchema, ULID_SCHEMA } from './schemas';
import { ulid } from './ulid';

const PRINGLES = {
  name: 'Pringles Original 165 г',
  brand: 'Pringles',
  barcode: '5 053990 101658',
  category: 'Снеки',
  product_family_id: 'chips',
  product_variant_id: 'potato_chips',
  is_organic: false,
  package_size: 165,
  package_unit: 'g',
  package_count: null,
  serving_size: 30,
  nutrition_basis: 'per_100_g',
  energy_kj: 2180,
  energy_kcal: 523,
  fat_g: 31.0,
  saturated_fat_g: 2.9,
  carbohydrate_g: 52.0,
  sugars_g: 2.4,
  fibre_g: 3.1,
  protein_g: 4.2,
  salt_g: 1.3,
  nutri_score: 'D',
  allergens: ['gluten'],
  allergen_traces: ['milk'],
  ingredients_text: 'Kartoffelflocken, Pflanzenöle (Sonnenblume, Mais), Maismehl',
  notes: null,
};

function parseImport(overrides: Record<string, unknown> = {}) {
  const result = PackagedProductImportSchema.safeParse({ ...PRINGLES, ...overrides });
  if (!result.success) throw new Error(JSON.stringify(result.error.issues));
  return result.data;
}

describe('makePackagedProduct', () => {
  it('mints a ULID, stamps timestamps and defaults the source to manual', () => {
    const product = makePackagedProduct({ name: 'Молоко 1 л', category: 'Молочка' });
    expect(ULID_SCHEMA.safeParse(product.id).success).toBe(true);
    expect(product.created_at).toBe(product.updated_at);
    expect(product.import_source).toBe('manual');
  });

  it('nulls every unsupplied optional rather than leaving it undefined', () => {
    const product = makePackagedProduct({ name: 'Молоко 1 л', category: 'Молочка' });
    expect(product.barcode).toBeNull();
    expect(product.brand).toBeNull();
    expect(product.nutrition_basis).toBeNull();
    expect(product.protein_g).toBeNull();
    expect(product.package_size).toBeNull();
    expect(product.allergens).toEqual([]);
  });

  it('rounds nutrients to 3dp and energy to 1dp', () => {
    const product = makePackagedProduct({
      name: 'Тест',
      category: 'Інше',
      nutrition_basis: 'per_100_g',
      salt_g: 1.23456,
      protein_g: 4.2005,
      energy_kcal: 523.04,
      energy_kj: 2180.06,
    });
    expect(product.salt_g).toBe(1.235);
    expect(product.protein_g).toBe(4.201);
    expect(product.energy_kcal).toBe(523);
    expect(product.energy_kj).toBe(2180.1);
  });

  it('trims text and collapses blanks to null', () => {
    const product = makePackagedProduct({
      name: '  Молоко 1 л  ',
      category: 'Молочка',
      brand: '   ',
      ingredients_text: '  Молоко  ',
    });
    expect(product.name).toBe('Молоко 1 л');
    expect(product.brand).toBeNull();
    expect(product.ingredients_text).toBe('Молоко');
  });

  it('strips barcode spacing', () => {
    const product = makePackagedProduct({
      name: 'Тест',
      category: 'Інше',
      barcode: '5 053990 101658',
    });
    expect(product.barcode).toBe('5053990101658');
  });

  it('rejects a nutrient without a basis', () => {
    expect(() =>
      makePackagedProduct({ name: 'Тест', category: 'Інше', protein_g: 5.6 }),
    ).toThrowError(/nutrition_basis is required/);
  });

  it('rejects saturated fat above total fat and sugars above carbohydrate', () => {
    expect(() =>
      makePackagedProduct({
        name: 'Тест',
        category: 'Інше',
        nutrition_basis: 'per_100_g',
        fat_g: 3,
        saturated_fat_g: 9,
      }),
    ).toThrowError(/saturated_fat_g cannot exceed fat_g/);

    expect(() =>
      makePackagedProduct({
        name: 'Тест',
        category: 'Інше',
        nutrition_basis: 'per_100_g',
        carbohydrate_g: 10,
        sugars_g: 25,
      }),
    ).toThrowError(/sugars_g cannot exceed carbohydrate_g/);
  });

  it('allows label rounding slack between fat and saturated fat', () => {
    const product = makePackagedProduct({
      name: 'Тест',
      category: 'Інше',
      nutrition_basis: 'per_100_g',
      fat_g: 0.5,
      saturated_fat_g: 0.5,
    });
    expect(product.saturated_fat_g).toBe(0.5);
  });

  it('rejects a package size without a unit', () => {
    expect(() =>
      makePackagedProduct({ name: 'Тест', category: 'Інше', package_size: 165 }),
    ).toThrowError(/package_size and package_unit must be set together/);
  });

  it('rejects a variant without a family', () => {
    expect(() =>
      makePackagedProduct({
        name: 'Тест',
        category: 'Інше',
        product_variant_id: 'potato_chips',
      }),
    ).toThrowError(/variant requires a family/);
  });
});

describe('packagedProductFromImport', () => {
  it('persists a realistic pasted payload', () => {
    const product = packagedProductFromImport(parseImport(), {
      import_source: 'manual-json',
      raw_import_json: PRINGLES,
    });

    expect(product.name).toBe('Pringles Original 165 г');
    expect(product.barcode).toBe('5053990101658');
    expect(product.package_size).toBe(165);
    expect(product.package_unit).toBe('g');
    expect(product.nutrition_basis).toBe('per_100_g');
    expect(product.energy_kcal).toBe(523);
    expect(product.fat_g).toBe(31);
    expect(product.nutri_score).toBe('D');
    expect(product.allergens).toEqual(['gluten']);
    expect(product.allergen_traces).toEqual(['milk']);
    expect(product.import_source).toBe('manual-json');
    expect(product.raw_import_json).toEqual(PRINGLES);
  });

  it('accepts German decimal commas and printed upper bounds', () => {
    const product = packagedProductFromImport(
      parseImport({ fat_g: '31,0', salt_g: '< 0,5', sugars_g: '2,4' }),
      { import_source: 'manual-json' },
    );
    expect(product.fat_g).toBe(31);
    expect(product.salt_g).toBe(0.5);
    expect(product.sugars_g).toBe(2.4);
  });

  it('normalizes label spellings of unit, basis and nutri-score', () => {
    const product = packagedProductFromImport(
      parseImport({ package_unit: 'Gramm', nutrition_basis: 'per 100 g', nutri_score: 'd' }),
      { import_source: 'manual-json' },
    );
    expect(product.package_unit).toBe('g');
    expect(product.nutrition_basis).toBe('per_100_g');
    expect(product.nutri_score).toBe('D');
  });

  it('drops allergens outside the EU FIC list instead of failing the paste', () => {
    const product = packagedProductFromImport(parseImport({ allergens: ['gluten', 'kiwi'] }), {
      import_source: 'manual-json',
    });
    expect(product.allergens).toEqual(['gluten']);
  });

  it('surfaces an unreadable basis as the missing-basis error', () => {
    expect(() =>
      packagedProductFromImport(parseImport({ nutrition_basis: 'per serving' }), {
        import_source: 'manual-json',
      }),
    ).toThrowError(/nutrition_basis is required/);
  });

  it('rejects a non-numeric nutrient at parse time', () => {
    const result = PackagedProductImportSchema.safeParse({ ...PRINGLES, protein_g: 'багато' });
    expect(result.success).toBe(false);
  });
});

describe('makePackagedProductPhoto', () => {
  it('defaults kind and sort order', () => {
    const photo = makePackagedProductPhoto({
      packaged_product_id: ulid(),
      storage_path: ' a@b.c/x/01.jpg ',
    });
    expect(photo.storage_path).toBe('a@b.c/x/01.jpg');
    expect(photo.kind).toBe('other');
    expect(photo.sort_order).toBe(0);
    expect(photo.content_type).toBeNull();
  });
});
