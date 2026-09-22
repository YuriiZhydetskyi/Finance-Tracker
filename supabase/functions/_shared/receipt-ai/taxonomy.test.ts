import { describe, expect, it } from 'vitest';
import { sanitizeParsedReceiptTaxonomy } from './taxonomy.ts';
import type { ParsedReceipt, ProductTaxonomyContext } from './types.ts';

const taxonomy: ProductTaxonomyContext = {
  families: [
    { id: 'tomatoes', name_uk: 'Помідори', name_en: 'Tomatoes', name_de: 'Tomaten' },
    { id: 'pasta', name_uk: 'Макарони', name_en: 'Pasta', name_de: 'Nudeln' },
  ],
  variants: [
    {
      id: 'tomatoes_cherry',
      family_id: 'tomatoes',
      name_uk: 'Черрі',
      name_en: 'Cherry tomatoes',
      name_de: 'Cherrytomaten',
    },
    {
      id: 'pasta_penne',
      family_id: 'pasta',
      name_uk: 'Пенне',
      name_en: 'Penne',
      name_de: 'Penne',
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

  it('keeps the known family but drops a variant from a different family', () => {
    const parsed = sanitizeParsedReceiptTaxonomy(
      {
        ...receipt,
        items: [
          {
            ...receipt.items[0]!,
            product_family_id: 'tomatoes',
            product_variant_id: 'pasta_penne',
          },
        ],
      },
      taxonomy,
    );

    expect(parsed.items[0]).toMatchObject({
      product_family_id: 'tomatoes',
      product_variant_id: null,
    });
  });

  it('preserves explicit true, identifiable non-Bio false, and ambiguous null statuses', () => {
    const parsed = sanitizeParsedReceiptTaxonomy(
      {
        ...receipt,
        items: [
          { ...receipt.items[0]!, is_organic: true },
          { ...receipt.items[0]!, product_name: 'Tomaten', is_organic: false },
          { ...receipt.items[0]!, product_name: 'ORIGINAL', is_organic: null },
        ],
      },
      taxonomy,
    );

    expect(parsed.items.map((item) => item.is_organic)).toEqual([true, false, null]);
  });
});
