import { describe, expect, it } from 'vitest';
import { makeItem, makeProduct } from './factories';
import { ItemSchema } from './schemas';
import { ProductClassificationSchema, ProductFamilySchema } from './product-taxonomy';

describe('product taxonomy', () => {
  it('accepts partial knowledge without inventing a standard variant', () => {
    expect(ProductClassificationSchema.parse({ product_family_id: 'tomato' })).toEqual({
      product_family_id: 'tomato',
    });
    expect(
      ProductClassificationSchema.safeParse({ product_variant_id: 'tomato_cherry' }).success,
    ).toBe(false);
  });

  it('requires three nonempty translations and stable nonlocalized IDs', () => {
    const family = {
      id: 'apple',
      name_uk: 'Яблука',
      name_en: 'Apples',
      name_de: 'Äpfel',
      aliases: ['яблуко', 'apple', 'Apfel'],
    };
    expect(ProductFamilySchema.parse(family)).toEqual(family);
    expect(ProductFamilySchema.safeParse({ ...family, name_de: ' ' }).success).toBe(false);
    expect(ProductFamilySchema.safeParse({ ...family, id: 'Яблука' }).success).toBe(false);
  });

  it('preserves an unlinked historical classification through the item factory and parsing', () => {
    const item = makeItem({
      receipt_id: '01HM4N6RXX5K2P9F8DZ7QWERTY',
      product_name: 'Cocktailtom.',
      category: 'Овочі/фрукти',
      product_family_id: 'tomato',
      product_variant_id: 'tomato_cocktail',
      qty: 1,
      unit_price_orig: 2,
      fx_rate_eur: 1,
      consumed_by: 'shared',
    });
    expect(item.product_id).toBeNull();
    expect(ItemSchema.parse(item).product_variant_id).toBe('tomato_cocktail');
  });

  it('keeps brand and organic independent of the family and variant', () => {
    const product = makeProduct({
      name: 'Barilla Penne',
      store: 'Aldi',
      category: 'Бакалія',
      product_family_id: 'pasta',
      product_variant_id: 'pasta_penne',
      brand: 'Barilla',
      is_organic: null,
    });
    expect(product).toMatchObject({
      product_family_id: 'pasta',
      product_variant_id: 'pasta_penne',
      brand: 'Barilla',
      is_organic: null,
    });
    expect(() =>
      makeProduct({
        name: 'Penne',
        store: 'Aldi',
        category: 'Бакалія',
        product_variant_id: 'pasta_penne',
      }),
    ).toThrow();
  });
});
