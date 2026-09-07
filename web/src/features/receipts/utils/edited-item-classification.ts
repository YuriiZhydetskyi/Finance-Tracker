import type { Item, ProductClassification } from '@finance-tracker/domain';

type EditedIdentity = {
  original_item_id?: string | undefined;
  product_id?: string | null | undefined;
  product_name: string;
  store_product_code?: string | null | undefined;
};

export function editedItemClassification(
  originalItems: Item[],
  edited: EditedIdentity,
  storeUnchanged: boolean,
): ProductClassification {
  const original = originalItems.find((item) => item.id === edited.original_item_id);
  if (!original) return {};
  if (
    !storeUnchanged ||
    original.product_id !== (edited.product_id ?? null) ||
    original.product_name !== edited.product_name ||
    original.store_product_code !== (edited.store_product_code ?? null)
  )
    return {};

  return {
    product_family_id: original.product_family_id ?? null,
    product_variant_id: original.product_variant_id ?? null,
  };
}
