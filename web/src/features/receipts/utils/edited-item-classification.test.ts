import { describe, expect, it } from 'vitest';
import { makeItem } from '@finance-tracker/domain';
import { editedItemClassification } from './edited-item-classification';

const apple = makeItem({
  receipt_id: '01HM4N6RXX5K2P9F8DZ7QWERTY',
  product_name: 'Apfel',
  category: 'Овочі/фрукти',
  product_family_id: 'apple',
  qty: 1,
  unit_price_orig: 1,
  fx_rate_eur: 1,
  consumed_by: 'shared',
});
const tomato = makeItem({
  receipt_id: apple.receipt_id,
  product_name: 'Tomaten',
  category: apple.category,
  product_family_id: 'tomato',
  qty: 1,
  unit_price_orig: 1,
  fx_rate_eur: 1,
  consumed_by: 'shared',
});
const identity = {
  original_item_id: apple.id,
  product_id: null,
  product_name: apple.product_name,
  store_product_code: null,
};

describe('editedItemClassification', () => {
  it('preserves classification of the same unlinked purchase', () => {
    expect(editedItemClassification([apple, tomato], identity, true)).toEqual({
      product_family_id: 'apple',
      product_variant_id: null,
    });
  });
  it('does not copy an old classification when renamed to another original row', () => {
    expect(
      editedItemClassification(
        [apple, tomato],
        { ...identity, product_name: tomato.product_name },
        true,
      ),
    ).toEqual({});
  });
  it('reclassifies a changed store, code, product link or newly added row', () => {
    expect(editedItemClassification([apple], identity, false)).toEqual({});
    expect(
      editedItemClassification([apple], { ...identity, store_product_code: 'new' }, true),
    ).toEqual({});
    expect(editedItemClassification([apple], { ...identity, product_id: 'new' }, true)).toEqual({});
    expect(
      editedItemClassification([apple], { ...identity, original_item_id: undefined }, true),
    ).toEqual({});
  });
});
