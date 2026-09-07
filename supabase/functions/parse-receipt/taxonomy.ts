import type { ParsedItem, ParsedReceipt, ProductTaxonomyContext } from './types.ts';

export const EMPTY_PRODUCT_TAXONOMY: ProductTaxonomyContext = { families: [], variants: [] };

/**
 * Provider schemas constrain individual IDs, but cannot express that a variant
 * belongs to the selected family. Keep malformed or stale suggestions out of
 * the persisted path without rejecting an otherwise usable receipt.
 */
export function sanitizeParsedReceiptTaxonomy<T extends ParsedReceipt>(
  parsed: T,
  taxonomy: ProductTaxonomyContext,
): T {
  return {
    ...parsed,
    items: parsed.items.map((item) => sanitizeItemTaxonomy(item, taxonomy)),
  };
}

export function sanitizeItemTaxonomy(
  item: ParsedItem,
  taxonomy: ProductTaxonomyContext,
): ParsedItem {
  const familyId = textOrNull(item.product_family_id);
  const variantId = textOrNull(item.product_variant_id);
  const familyKnown =
    familyId !== null && taxonomy.families.some((family) => family.id === familyId);
  const variant = variantId
    ? taxonomy.variants.find((candidate) => candidate.id === variantId)
    : undefined;
  const validFamilyId = familyKnown ? familyId : null;
  const validVariantId = variant && variant.family_id === validFamilyId ? variant.id : null;

  return {
    ...item,
    product_family_id: validFamilyId,
    product_variant_id: validVariantId,
    brand: textOrNull(item.brand),
    is_organic: typeof item.is_organic === 'boolean' ? item.is_organic : null,
  };
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
