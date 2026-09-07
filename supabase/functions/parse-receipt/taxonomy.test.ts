import { describe, expect, it } from 'vitest';
import { sanitizeParsedReceiptTaxonomy } from './taxonomy.ts';
import type { ParsedReceipt, ProductTaxonomyContext } from './types.ts';

const taxonomy: ProductTaxonomyContext = {
  families: [{ id: 'tomatoes', name_uk: 'Помідори', name_en: 'Tomatoes', name_de: 'Tomaten' }],
  variants: [
    {
      id: 'tomatoes_cherry',
      family_id: 'tomatoes',
      name_uk: 'Черрі',
      name_en: 'Cherry tomatoes',
      name_de: 'Cherrytomaten',
    },
  ],
};

const receipt: ParsedReceipt = {
  store: 'Aldi',
  date: '2026-09-07',
  currency: 'EUR',
  total_orig: 1,
  items: [
    {
      product_name: 'Tomaten Cherry',
      qty: 1,
      unit_price_orig: 1,
      category_suggestion: 'Овочі/фрукти',
      product_family_id: 'tomatoes',
      product_variant_id: 'tomatoes_cherry',
      brand: 'Gut Bio',
      is_organic: true,
    },
  ],
};

describe('sanitizeParsedReceiptTaxonomy', () => {
  it('keeps an allowed family, matching variant, brand and organic status', () => {
    expect(sanitizeParsedReceiptTaxonomy(receipt, taxonomy).items[0]).toMatchObject({
      product_family_id: 'tomatoes',
      product_variant_id: 'tomatoes_cherry',
      brand: 'Gut Bio',
      is_organic: true,
    });
  });

  it('converts invented or cross-family IDs to unknown without losing the receipt row', () => {
    const parsed = sanitizeParsedReceiptTaxonomy(
      {
        ...receipt,
        items: [
          {
            ...receipt.items[0]!,
            product_family_id: 'invented',
            product_variant_id: 'tomatoes_cherry',
          },
        ],
      },
      taxonomy,
    );

    expect(parsed.items[0]).toMatchObject({
      product_name: 'Tomaten Cherry',
      product_family_id: null,
      product_variant_id: null,
    });
  });
});
