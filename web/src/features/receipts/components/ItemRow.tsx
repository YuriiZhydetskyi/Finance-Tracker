import { useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { Input } from '@/shared/ui/Input';
import { Button } from '@/shared/ui/Button';
import { cn } from '@/shared/ui/cn';
import { CreateCategoryDialog } from '@/features/categories';
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
    setValue,
    watch,
    formState: { errors },
  } = useFormContext<ManualFormValues>();

  const [createCategoryOpen, setCreateCategoryOpen] = useState(false);

  const item = watch(`items.${index}`);
  const currency = watch('currency');
  const rowTotal = computeRowTotal(item);
  const itemErrors = errors.items?.[index];
  const priceIsNegative = (item?.unit_price_orig ?? 0) < 0;
  const marker = item?.pair_marker;
  const isCancelled = marker?.kind === 'cancelled';
  const isDiscountMerged = marker?.kind === 'discount-merged';
  const isAggregated = marker?.kind === 'aggregated';
  const markerCount = marker?.count ?? 1;

  const qty = item?.qty ?? 0;
  const unitPrice = item?.unit_price_orig ?? 0;
  const discount = item?.discount_orig ?? 0;
  const originalTotal = qty * unitPrice;
  const discountTotal = qty * discount;

  const cancelledLabel =
    markerCount > 1
      ? `⚠ Пробито випадково · ${String(markerCount)} однакові пари згруповано`
      : '⚠ Пробито випадково · автоматично згруповано';
  const discountMergedLabel =
    markerCount > 1
      ? `🏷 Знижка · ${String(markerCount)} однакові пари згруповано`
      : '🏷 Знижка · автоматично згруповано';
  const aggregatedLabel = `🔗 ${String(markerCount)} рядки з чека згруповано`;

  return (
    <div
      className={cn(
        'rounded-md border bg-white p-3 shadow-sm',
        isCancelled && 'border-amber-300 bg-amber-50/50',
        isDiscountMerged && 'border-emerald-300 bg-emerald-50/30',
        isAggregated && 'border-slate-200 bg-slate-50/50',
        !isCancelled && !isDiscountMerged && !isAggregated && 'border-slate-200',
      )}
    >
      {isCancelled && (
        <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
          {cancelledLabel}
        </div>
      )}
      {isDiscountMerged && (
        <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
          {discountMergedLabel}
        </div>
      )}
      {isAggregated && (
        <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
          {aggregatedLabel}
        </div>
      )}

      <div className="grid grid-cols-12 gap-2">
        <div className="col-span-12 sm:col-span-5">
          <label className={FIELD_LABEL_CLASS}>Товар</label>
          <div className="flex gap-1">
            <Input
              list="products-datalist"
              placeholder="Назва"
              className="flex-1 min-w-0"
              {...register(`items.${index}.product_name`)}
            />
            <Input
              placeholder="Код"
              title="Код товару у магазині (з чека)"
              className="w-20 shrink-0"
              {...register(`items.${index}.store_product_code`, {
                setValueAs: (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null),
              })}
            />
          </div>
          {itemErrors?.product_name && (
            <span className="text-xs text-red-600">{itemErrors.product_name.message}</span>
          )}
        </div>

        <div className="col-span-6 sm:col-span-3">
          <label className={FIELD_LABEL_CLASS}>Категорія</label>
          <div className="flex items-stretch gap-1">
            <select className={SELECT_CLASS} {...register(`items.${index}.category`)}>
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {item?.category === 'Інше' && (
              <button
                type="button"
                aria-label="Створити нову категорію"
                title="Створити нову категорію"
                onClick={() => {
                  setCreateCategoryOpen(true);
                }}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-lg font-semibold leading-none text-white transition hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
              >
                +
              </button>
            )}
          </div>
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
            disabled={isCancelled}
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
            disabled={isCancelled}
            className={cn(priceIsNegative && 'border-red-400 text-red-700')}
            {...register(`items.${index}.unit_price_orig`, { valueAsNumber: true })}
          />
        </div>
      </div>

      <div className="mt-2 grid grid-cols-12 gap-2">
        <div className="col-span-6 sm:col-span-3">
          <label className={FIELD_LABEL_CLASS}>Хто</label>
          <select className={SELECT_CLASS} {...register(`items.${index}.consumed_by`)}>
            <option value="his">Він</option>
            <option value="hers">Вона</option>
            <option value="shared">Спільне</option>
          </select>
        </div>
        <div className="col-span-3 sm:col-span-2">
          <label className={FIELD_LABEL_CLASS}>Знижка</label>
          <Input
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            disabled={isCancelled}
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
            disabled={isCancelled}
            {...register(`items.${index}.wasted_qty`, { valueAsNumber: true })}
          />
        </div>
        <div className="col-span-12 sm:col-span-5">
          <label className={FIELD_LABEL_CLASS}>Нотатка</label>
          <Input placeholder="—" {...register(`items.${index}.note`)} />
        </div>
      </div>

      <div className="mt-3 border-t border-slate-100 pt-2">
        {isDiscountMerged ? (
          <div className="flex flex-col gap-1 text-sm tabular-nums sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5 text-xs text-slate-600">
              <div>
                Оригінал: {qty} × {formatMoney(unitPrice, currency)} ={' '}
                <span className="font-medium text-slate-700">
                  {formatMoney(originalTotal, currency)}
                </span>
              </div>
              <div>
                Знижка:{' '}
                <span className="font-medium text-emerald-700">
                  −{formatMoney(discountTotal, currency)}
                </span>
              </div>
              <div className="text-sm text-slate-800">
                Фінал: <span className="font-semibold">{formatMoney(rowTotal, currency)}</span>
              </div>
            </div>
            <Button variant="ghost" type="button" onClick={onRemove}>
              Видалити
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span
              className={cn(
                'text-sm tabular-nums text-slate-700',
                rowTotal < 0 && 'font-medium text-red-600',
                isCancelled && 'text-amber-700',
              )}
            >
              Рядок: {formatMoney(rowTotal, currency)}
            </span>
            <Button variant="ghost" type="button" onClick={onRemove}>
              Видалити
            </Button>
          </div>
        )}
      </div>

      {createCategoryOpen && (
        <CreateCategoryDialog
          open
          onClose={() => {
            setCreateCategoryOpen(false);
          }}
          onCreated={(name) => {
            setValue(`items.${index}.category`, name, {
              shouldDirty: true,
              shouldValidate: true,
            });
          }}
        />
      )}
    </div>
  );
}
