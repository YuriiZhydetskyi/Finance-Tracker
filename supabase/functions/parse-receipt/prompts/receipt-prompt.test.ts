import { describe, expect, it } from 'vitest';
import { buildPrompt, buildSchema } from './receipt-prompt.ts';
import type { AiContext } from '../types.ts';

const ctx: AiContext = {
  categories: ['Food'],
  products: [],
  mimeType: 'image/jpeg',
  taxonomy: {
    families: [
      { id: 'tomatoes', name_uk: 'Помідори', name_en: 'Tomatoes', name_de: 'Tomaten' },
      { id: 'pasta', name_uk: 'Макарони', name_en: 'Pasta', name_de: 'Nudeln' },
    ],
    variants: [
      {
        id: 'tomatoes_cherry',
        family_id: 'tomatoes',
        name_uk: 'Помідори чері',
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
  },
};

describe('receipt taxonomy prompt', () => {
  it('requires evidence-based family, variant, brand and organic suggestions', () => {
    const prompt = buildPrompt(ctx);

    expect(prompt).toContain('product_variant_id must belong to product_family_id');
    expect(prompt).toContain(
      'Never infer a product from a flavour-only word such as "Original" or "Wings"',
    );
    expect(prompt).toContain('brand: copy a brand only when it is explicitly printed');
    expect(prompt).toContain('true only when the product itself explicitly says Bio/organic/öko');
    expect(prompt).toContain(
      'identified FOOD product whose printed name has no such label, return false',
    );
    expect(prompt).toContain('For an ambiguous product or a non-food item, return null');
  });

  it('requires nullable taxonomy, brand and organic fields and restricts IDs to the catalogue', () => {
    const schema = buildSchema(ctx) as {
      properties: {
        items: {
          items: {
            properties: Record<string, { enum?: unknown[]; type?: unknown }>;
            required: string[];
          };
        };
      };
    };
    const item = schema.properties.items.items;

    expect(item.required).toEqual(
      expect.arrayContaining(['product_family_id', 'product_variant_id', 'brand', 'is_organic']),
    );
    expect(item.properties.product_family_id.enum).toEqual(['tomatoes', 'pasta', null]);
    expect(item.properties.product_variant_id.enum).toEqual([
      'tomatoes_cherry',
      'pasta_penne',
      null,
    ]);
    expect(item.properties.brand.type).toEqual(['string', 'null']);
    expect(item.properties.is_organic.type).toEqual(['boolean', 'null']);
  });
});
