import { useFormContext } from 'react-hook-form';
import { Input } from '@/shared/ui/Input';
import { Button } from '@/shared/ui/Button';
import { cn } from '@/shared/ui/cn';
import type { ManualFormValues } from '../schemas/manual-form';
import { computeRowTotal } from '../utils/totals';
import { formatMoney } from '@/shared/utils/format-money';

type Props = {
  index: number;
  categories: string[];
  onRemove: () => void;
};

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900';

const FIELD_LABEL_CLASS = 'text-xs font-medium text-slate-600';

export function ItemRow({ index, categories, onRemove }: Props) {
  const {
    register,
    watch,
    formState: { errors },
  } = useFormContext<ManualFormValues>();

  const item = watch(`items.${index}`);
  const currency = watch('currency');
  const rowTotal = computeRowTotal(item);
  const itemErrors = errors.items?.[index];
  const priceIsNegative = (item?.unit_price_orig ?? 0) < 0;

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
      <div className="grid grid-cols-12 gap-2">
        <div className="col-span-12 sm:col-span-5">
          <label className={FIELD_LABEL_CLASS}>Товар</label>
          <Input
            list="products-datalist"
            placeholder="Назва"
            {...register(`items.${index}.product_name`)}
          />
          {itemErrors?.product_name && (
            <span className="text-xs text-red-600">{itemErrors.product_name.message}</span>
          )}
        </div>

        <div className="col-span-6 sm:col-span-3">
          <label className={FIELD_LABEL_CLASS}>Категорія</label>
          <select className={SELECT_CLASS} {...register(`items.${index}.category`)}>
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {itemErrors?.category && (
            <span className="text-xs text-red-600">{itemErrors.category.message}</span>
          )}
        </div>

        <div className="col-span-6 sm:col-span-2">
          <label className={FIELD_LABEL_CLASS}>К-сть</label>
          <Input
            type="number"
            step="0.001"
            min="0"
            inputMode="decimal"
            {...register(`items.${index}.qty`, { valueAsNumber: true })}
          />
          {itemErrors?.qty && (
            <span className="text-xs text-red-600">{itemErrors.qty.message}</span>
          )}
        </div>

        <div className="col-span-6 sm:col-span-2">
          <label className={FIELD_LABEL_CLASS}>Ціна</label>
          {/* No min: negatives allowed for Pfand refunds, discount lines, cancellations. */}
          <Input
            type="number"
            step="0.01"
            inputMode="decimal"
            className={cn(priceIsNegative && 'border-red-400 text-red-700')}
            {...register(`items.${index}.unit_price_orig`, { valueAsNumber: true })}
          />
        </div>
      </div>

      <div className="mt-2 grid grid-cols-12 gap-2">
        <div className="col-span-6 sm:col-span-3">
          <label className={FIELD_LABEL_CLASS}>Хто</label>
          <select className={SELECT_CLASS} {...register(`items.${index}.consumed_by`)}>
            <option value="shared">Спільно</option>
            <option value="his">Він</option>
            <option value="hers">Вона</option>
            <option value="custom:30/70">30 / 70</option>
            <option value="custom:70/30">70 / 30</option>
          </select>
        </div>
        <div className="col-span-3 sm:col-span-2">
          <label className={FIELD_LABEL_CLASS}>Знижка</label>
          <Input
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            {...register(`items.${index}.discount_orig`, { valueAsNumber: true })}
          />
        </div>
        <div className="col-span-3 sm:col-span-2">
          <label className={FIELD_LABEL_CLASS}>Зіпсовано</label>
          <Input
            type="number"
            step="0.001"
            min="0"
            inputMode="decimal"
            {...register(`items.${index}.wasted_qty`, { valueAsNumber: true })}
          />
        </div>
        <div className="col-span-12 sm:col-span-5">
          <label className={FIELD_LABEL_CLASS}>Нотатка</label>
          <Input placeholder="—" {...register(`items.${index}.note`)} />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2">
        <span
          className={cn(
            'text-sm tabular-nums text-slate-700',
            rowTotal < 0 && 'font-medium text-red-600',
          )}
        >
          Рядок: {formatMoney(rowTotal, currency)}
        </span>
        <Button variant="ghost" type="button" onClick={onRemove}>
          Видалити
        </Button>
      </div>
    </div>
  );
}
