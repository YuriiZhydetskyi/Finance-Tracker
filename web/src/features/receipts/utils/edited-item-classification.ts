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
  if (!isEditedItemIdentityUnchanged(originalItems, edited, storeUnchanged)) return {};
  const original = originalItems.find((item) => item.id === edited.original_item_id)!;

  return {
    product_family_id: original.product_family_id ?? null,
    product_variant_id: original.product_variant_id ?? null,
  };
}

export function isEditedItemIdentityUnchanged(
  originalItems: Item[],
  edited: EditedIdentity,
  storeUnchanged: boolean,
): boolean {
  const original = originalItems.find((item) => item.id === edited.original_item_id);
  return (
    original != null &&
    storeUnchanged &&
    original.product_id === (edited.product_id ?? null) &&
    original.product_name === edited.product_name &&
    original.store_product_code === (edited.store_product_code ?? null)
  );
}

export function resolvedEditedItemClassification(
  originalItems: Item[],
  edited: EditedIdentity & {
    product_family_id?: string | null | undefined;
    product_variant_id?: string | null | undefined;
    product_metadata_override?: boolean | undefined;
  },
  storeUnchanged: boolean,
): ProductClassification {
  if (edited.product_metadata_override) {
    return {
      product_family_id: edited.product_family_id ?? null,
      product_variant_id: edited.product_variant_id ?? null,
    };
  }
  return editedItemClassification(originalItems, edited, storeUnchanged);
}
