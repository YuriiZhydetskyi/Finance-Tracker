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

  it('defaults review notes to none and normalizes supplied ones', () => {
    expect(makePackagedProduct({ name: 'Тест', category: 'Інше' }).review_notes).toEqual([]);
    const product = makePackagedProduct({
      name: 'Тест',
      category: 'Інше',
      review_notes: ['  Нечіткий штрихкод ', 'нечіткий штрихкод', ''],
    });
    expect(product.review_notes).toEqual(['Нечіткий штрихкод']);
  });

  it('rejects a review note longer than 300 characters and more than 50 notes', () => {
    expect(() =>
      makePackagedProduct({ name: 'Тест', category: 'Інше', review_notes: ['я'.repeat(301)] }),
    ).toThrow();
    expect(() =>
      makePackagedProduct({
        name: 'Тест',
        category: 'Інше',
        review_notes: Array.from({ length: 51 }, (_, i) => `note ${String(i)}`),
      }),
    ).toThrow();
    expect(
      makePackagedProduct({ name: 'Тест', category: 'Інше', review_notes: ['я'.repeat(300)] })
        .review_notes,
    ).toHaveLength(1);
  });

  it('defaults attributes to none and normalizes supplied ones', () => {
    expect(makePackagedProduct({ name: 'Тест', category: 'Інше' }).attributes).toEqual({});
    const product = makePackagedProduct({
      name: 'Тест',
      category: 'Інше',
      attributes: { ' Сорт ': ' Jonagold ', сорт: 'Gala', Клас: '' },
    });
    expect(product.attributes).toEqual({ Сорт: 'Jonagold' });
  });

  it('rejects an attribute key over 60 characters, a value over 300 and more than 30 pairs', () => {
    expect(() =>
      makePackagedProduct({
        name: 'Тест',
        category: 'Інше',
        attributes: { ['к'.repeat(61)]: 'x' },
      }),
    ).toThrow();
    expect(() =>
      makePackagedProduct({
        name: 'Тест',
        category: 'Інше',
        attributes: { Сорт: 'я'.repeat(301) },
      }),
    ).toThrow();
    expect(() =>
      makePackagedProduct({
        name: 'Тест',
        category: 'Інше',
        attributes: Object.fromEntries(
          Array.from({ length: 31 }, (_, i) => [`ключ ${String(i)}`, 'значення']),
        ),
      }),
    ).toThrow();
    expect(
      makePackagedProduct({
        name: 'Тест',
        category: 'Інше',
        attributes: { ['к'.repeat(60)]: 'я'.repeat(300) },
      }).attributes,
    ).toEqual({ ['к'.repeat(60)]: 'я'.repeat(300) });
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

  describe('review_notes', () => {
    it.each([
      ['absent', {}],
      ['null', { review_notes: null }],
      ['empty', { review_notes: [] }],
    ])('means nothing to check when %s', (_name, overrides) => {
      const parsed = parseImport(overrides);
      expect(parsed.review_notes).toEqual([]);
      const product = packagedProductFromImport(parsed, { import_source: 'manual-json' });
      expect(product.review_notes).toEqual([]);
    });

    it('persists trimmed, deduplicated notes in order', () => {
      const parsed = parseImport({
        review_notes: [
          '  Штрихкод розмитий: перевір останні цифри ',
          'Збіг із чеком REWE «Originals» неоднозначний',
          'штрихкод розмитий: перевір останні цифри',
        ],
      });
      expect(parsed.review_notes).toEqual([
        'Штрихкод розмитий: перевір останні цифри',
        'Збіг із чеком REWE «Originals» неоднозначний',
      ]);
      const product = packagedProductFromImport(parsed, { import_source: 'manual-json' });
      expect(product.review_notes).toEqual(parsed.review_notes);
    });

    it('drops blank entries instead of failing the paste', () => {
      expect(
        parseImport({ review_notes: ['', '   ', 'Немає зворотного боку'] }).review_notes,
      ).toEqual(['Немає зворотного боку']);
    });

    it('accepts exactly 10 notes of exactly 300 characters', () => {
      const notes = Array.from({ length: 10 }, (_, i) => `${String(i)}`.padEnd(300, 'я'));
      expect(parseImport({ review_notes: notes }).review_notes).toHaveLength(10);
    });

    it.each([
      ['more than 10 notes', Array.from({ length: 11 }, (_, i) => `note ${String(i)}`)],
      ['a note over 300 characters', ['я'.repeat(301)]],
      ['a non-string entry', [42]],
      ['a bare string instead of an array', 'Перевір штрихкод'],
    ])('rejects %s', (_name, review_notes) => {
      expect(PackagedProductImportSchema.safeParse({ ...PRINGLES, review_notes }).success).toBe(
        false,
      );
    });

    it('still tolerates unknown extra fields next to review_notes', () => {
      const result = PackagedProductImportSchema.safeParse({
        ...PRINGLES,
        review_notes: ['Перевір штрихкод'],
        source_pages: [{ page: 2, kind: 'front' }],
        confidence: 0.4,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('attributes', () => {
    const APPLE_LABEL = {
      Сорт: 'Jonagold',
      Калібр: '65–70 мм',
      Клас: 'I',
      'Країна походження': 'Німеччина',
    };

    it.each([
      ['absent', {}],
      ['null', { attributes: null }],
      ['empty', { attributes: {} }],
    ])('means nothing recorded when %s', (_name, overrides) => {
      const parsed = parseImport(overrides);
      expect(parsed.attributes).toEqual({});
      const product = packagedProductFromImport(parsed, { import_source: 'manual-json' });
      expect(product.attributes).toEqual({});
    });

    it('persists the pairs of a label', () => {
      const parsed = parseImport({ attributes: APPLE_LABEL });
      expect(parsed.attributes).toEqual(APPLE_LABEL);
      const product = packagedProductFromImport(parsed, { import_source: 'manual-json' });
      expect(product.attributes).toEqual(APPLE_LABEL);
    });

    it('trims, reads numbers as text and drops blank, null and duplicate pairs', () => {
      const parsed = parseImport({
        attributes: {
          ' Сорт ': ' Jonagold ',
          сорт: 'Gala',
          Клас: 1,
          Калібр: '   ',
          Походження: null,
          '': 'без назви',
        },
      });
      expect(parsed.attributes).toEqual({ Сорт: 'Jonagold', Клас: '1' });
    });

    it('accepts exactly 15 pairs of 60 + 300 characters', () => {
      const attributes = Object.fromEntries(
        Array.from({ length: 15 }, (_, i) => [`${String(i)}`.padEnd(60, 'к'), 'я'.repeat(300)]),
      );
      expect(Object.keys(parseImport({ attributes }).attributes)).toHaveLength(15);
    });

    it.each([
      [
        'more than 15 pairs',
        Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`ключ ${String(i)}`, 'x'])),
      ],
      ['a key over 60 characters', { ['к'.repeat(61)]: 'x' }],
      ['a value over 300 characters', { Сорт: 'я'.repeat(301) }],
      ['a boolean value', { Bio: true }],
      ['an array value', { Сертифікати: ['Bio', 'Fairtrade'] }],
      ['a nested object', { Походження: { країна: 'Польща' } }],
      ['an array instead of an object', ['Сорт: Jonagold']],
      ['a bare string instead of an object', 'Сорт: Jonagold'],
    ])('rejects %s', (_name, attributes) => {
      expect(PackagedProductImportSchema.safeParse({ ...PRINGLES, attributes }).success).toBe(
        false,
      );
    });

    it('names the field and the offending key in the issue', () => {
      const result = PackagedProductImportSchema.safeParse({
        ...PRINGLES,
        attributes: { Сорт: 'я'.repeat(301) },
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain(
        'attributes.Сорт',
      );
    });

    it('still tolerates unknown extra fields next to attributes', () => {
      const result = PackagedProductImportSchema.safeParse({
        ...PRINGLES,
        attributes: { Сорт: 'Jonagold' },
        source_pages: [{ page: 2, kind: 'front' }],
        confidence: 0.4,
      });
      expect(result.success).toBe(true);
    });
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
