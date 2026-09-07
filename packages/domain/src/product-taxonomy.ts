import { z } from 'zod';

// Stable identifiers survive translation and display-name corrections.
export const TAXONOMY_ID_SCHEMA = z.string().regex(/^[a-z][a-z0-9_]*$/);

export const ProductClassificationSchema = z
  .object({
    product_family_id: TAXONOMY_ID_SCHEMA.nullable().optional(),
    product_variant_id: TAXONOMY_ID_SCHEMA.nullable().optional(),
  })
  .refine((value) => value.product_variant_id == null || value.product_family_id != null, {
    message: 'A product variant requires a family',
    path: ['product_variant_id'],
  });

export const ProductFamilySchema = z.object({
  id: TAXONOMY_ID_SCHEMA,
  name_uk: z.string().trim().min(1),
  name_en: z.string().trim().min(1),
  name_de: z.string().trim().min(1),
  aliases: z.array(z.string().trim().min(1)),
});

export const ProductVariantSchema = ProductFamilySchema.extend({
  family_id: TAXONOMY_ID_SCHEMA,
});

export type ProductClassification = z.infer<typeof ProductClassificationSchema>;
export type ProductFamily = z.infer<typeof ProductFamilySchema>;
export type ProductVariant = z.infer<typeof ProductVariantSchema>;
