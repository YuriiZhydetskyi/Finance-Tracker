import type { ReactNode } from 'react';
import type { UseFieldArrayReturn } from 'react-hook-form';
import { useFormContext } from 'react-hook-form';
import { Input } from '@/shared/ui/Input';
import { ErrorDetails } from '@/shared/ui/ErrorDetails';
import { FIELD_LABEL_CLASS, SELECT_CLASS } from '@/shared/ui/select-classes';
import { ItemsList } from './ItemsList';
import { SummaryFooter } from './SummaryFooter';
import { SUPPORTED_CURRENCIES, type ManualFormValues } from '../schemas/manual-form';

// RHF `register` returns `any` from the input event, so an inline arrow trips
// no-unsafe-return. Hoist as a typed helper; HTML inputs always emit string.
function emptyStringToNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

type Props = {
  itemsArray: UseFieldArrayReturn<ManualFormValues, 'items', 'id'>;
  categories: string[];
  productNames: string[];
  paidByOptions: string[];
  saveError?: Error | null;
  /** Action buttons rendered at the bottom of the form (Save/Cancel/Delete). */
  actions: ReactNode;
};

/**
 * Inner shell of every receipt form (manual create + edit). The parent owns
 * the FormProvider and the submit handler; this component just renders the
 * fields and lays out the actions slot.
 */
export function ReceiptFormFields({
  itemsArray,
  categories,
  productNames,
  paidByOptions,
  saveError,
  actions,
}: Props) {
  const {
    register,
    watch,
    formState: { errors },
  } = useFormContext<ManualFormValues>();

  const itemErrors = errors.items as { root?: { message?: string } } | undefined;
  const merchantOrderId = watch('merchant_order_id');

  return (
    <div className="space-y-4">
      {merchantOrderId && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Amazon · замовлення <span className="font-mono font-medium">{merchantOrderId}</span>
        </div>
      )}
      <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-6 sm:col-span-2">
            <label className={FIELD_LABEL_CLASS}>Дата</label>
            <Input type="date" {...register('date')} />
            {errors.date && <span className="text-xs text-red-600">{errors.date.message}</span>}
          </div>
          <div className="col-span-6 sm:col-span-2">
            <label className={FIELD_LABEL_CLASS}>Час (опц.)</label>
            <Input type="time" {...register('time', { setValueAs: emptyStringToNull })} />
            {errors.time && <span className="text-xs text-red-600">{errors.time.message}</span>}
          </div>
          <div className="col-span-12 sm:col-span-4">
            <label className={FIELD_LABEL_CLASS}>Магазин / опис</label>
            <Input placeholder="Lidl, Amazon, оренда..." {...register('store')} />
            {errors.store && <span className="text-xs text-red-600">{errors.store.message}</span>}
          </div>
          <div className="col-span-6 sm:col-span-2">
            <label className={FIELD_LABEL_CLASS}>Валюта</label>
            <select className={SELECT_CLASS} {...register('currency')}>
              {SUPPORTED_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-6 sm:col-span-2">
            <label className={FIELD_LABEL_CLASS}>Оплатив</label>
            <select className={SELECT_CLASS} {...register('paid_by')}>
              {paidByOptions.map((email) => (
                <option key={email} value={email}>
                  {email}
                </option>
              ))}
            </select>
            {errors.paid_by && (
              <span className="text-xs text-red-600">{errors.paid_by.message}</span>
            )}
          </div>
          <div className="col-span-12">
            <label className={FIELD_LABEL_CLASS}>Адреса магазину (опц.)</label>
            <Input
              placeholder="Hauptstr. 12, 80331 München"
              {...register('store_address', { setValueAs: emptyStringToNull })}
            />
          </div>
          <div className="col-span-12">
            <label className={FIELD_LABEL_CLASS}>Нотатка (опц.)</label>
            <Input placeholder="—" {...register('note')} />
          </div>
        </div>
      </div>

      <ItemsList itemsArray={itemsArray} categories={categories} productNames={productNames} />

      {itemErrors?.root && <p className="text-sm text-red-600">{itemErrors.root.message}</p>}

      <SummaryFooter />

      {saveError && <ErrorDetails error={saveError} label="Помилка збереження" />}

      <div className="flex flex-wrap items-center gap-3">{actions}</div>
    </div>
  );
}
