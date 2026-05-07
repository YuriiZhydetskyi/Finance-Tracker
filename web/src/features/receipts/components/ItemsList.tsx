import type { UseFieldArrayReturn } from 'react-hook-form';
import { Button } from '@/shared/ui/Button';
import { ItemRow } from './ItemRow';
import { emptyItemRow } from '../hooks/use-receipt-form';
import type { ManualFormValues } from '../schemas/manual-form';

type Props = {
  itemsArray: UseFieldArrayReturn<ManualFormValues, 'items'>;
  categories: string[];
  productNames: string[];
};

export function ItemsList({ itemsArray, categories, productNames }: Props) {
  return (
    <div className="space-y-3">
      <datalist id="products-datalist">
        {productNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {itemsArray.fields.map((field, index) => (
        <ItemRow
          key={field.id}
          index={index}
          categories={categories}
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
