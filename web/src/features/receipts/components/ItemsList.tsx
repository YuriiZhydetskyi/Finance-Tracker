import { useId } from 'react';
import type { UseFieldArrayReturn } from 'react-hook-form';
import { Button } from '@/shared/ui/Button';
import { ItemRow } from './ItemRow';
import { emptyItemRow } from '../hooks/use-receipt-form';
import type { ManualFormValues } from '../schemas/manual-form';
import type { ProductTaxonomy } from '@/features/products/api/use-products';

type Props = {
  itemsArray: UseFieldArrayReturn<ManualFormValues, 'items'>;
  categories: string[];
  productNames: string[];
  taxonomy: ProductTaxonomy;
};

export function ItemsList({ itemsArray, categories, productNames, taxonomy }: Props) {
  const productListId = useId();

  return (
    <div className="space-y-3">
      <datalist id={productListId}>
        {productNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {itemsArray.fields.map((field, index) => (
        <ItemRow
          key={field.id}
          index={index}
          productListId={productListId}
          categories={categories}
          taxonomy={taxonomy}
          onRemove={() => {
            itemsArray.remove(index);
          }}
        />
      ))}

      <Button
        variant="secondary"
        type="button"
        onClick={() => {
          itemsArray.append(emptyItemRow());
        }}
      >
        + Додати товар
      </Button>
    </div>
  );
}
