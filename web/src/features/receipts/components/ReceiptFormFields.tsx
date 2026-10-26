import { useId, type ReactNode } from 'react';
import type { UseFieldArrayReturn } from 'react-hook-form';
import { useFormContext, useWatch } from 'react-hook-form';
import { Input } from '@/shared/ui/Input';
import { ErrorDetails } from '@/shared/ui/ErrorDetails';
import { FIELD_LABEL_CLASS, SELECT_CLASS } from '@/shared/ui/select-classes';
import { ItemsList } from './ItemsList';
import { SummaryFooter } from './SummaryFooter';
import { SUPPORTED_CURRENCIES, type ManualFormValues } from '../schemas/manual-form';
import type { ProductTaxonomy } from '@/features/products/api/use-products';

// RHF `register` returns `any` from the input event, so an inline arrow trips
// no-unsafe-return. Hoist as a typed helper; HTML inputs always emit string.
function emptyStringToNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

type Props = {
  itemsArray: UseFieldArrayReturn<ManualFormValues, 'items', 'id'>;
  categories: string[];
  productNames: string[];
  taxonomy: ProductTaxonomy;
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
  taxonomy,
  paidByOptions,
  saveError,
  actions,
}: Props) {
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<ManualFormValues>();

  const idPrefix = useId();
  const fieldId = (field: string) => `${idPrefix}-${field}`;

  const itemErrors = errors.items as { root?: { message?: string } } | undefined;
  const merchantOrderId = useWatch({ control, name: 'merchant_order_id' });

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
            <label htmlFor={fieldId('date')} className={FIELD_LABEL_CLASS}>
              Дата
            </label>
            <Input id={fieldId('date')} type="date" {...register('date')} />
            {errors.date && <span className="text-xs text-red-600">{errors.date.message}</span>}
          </div>
          <div className="col-span-6 sm:col-span-2">
            <label htmlFor={fieldId('time')} className={FIELD_LABEL_CLASS}>
              Час (опц.)
            </label>
            <Input
              id={fieldId('time')}
              type="time"
              {...register('time', { setValueAs: emptyStringToNull })}
            />
            {errors.time && <span className="text-xs text-red-600">{errors.time.message}</span>}
          </div>
          <div className="col-span-12 sm:col-span-4">
            <label htmlFor={fieldId('store')} className={FIELD_LABEL_CLASS}>
              Магазин / опис
            </label>
            <Input
              id={fieldId('store')}
              placeholder="Lidl, Amazon, оренда..."
              {...register('store')}
            />
            {errors.store && <span className="text-xs text-red-600">{errors.store.message}</span>}
          </div>
          <div className="col-span-6 sm:col-span-2">
            <label htmlFor={fieldId('currency')} className={FIELD_LABEL_CLASS}>
              Валюта
            </label>
            <select id={fieldId('currency')} className={SELECT_CLASS} {...register('currency')}>
              {SUPPORTED_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-6 sm:col-span-2">
            <label htmlFor={fieldId('paid-by')} className={FIELD_LABEL_CLASS}>
              Оплатив
            </label>
            <select id={fieldId('paid-by')} className={SELECT_CLASS} {...register('paid_by')}>
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
            <label htmlFor={fieldId('store-address')} className={FIELD_LABEL_CLASS}>
              Адреса магазину (опц.)
            </label>
            <Input
              id={fieldId('store-address')}
              placeholder="Hauptstr. 12, 80331 München"
              {...register('store_address', { setValueAs: emptyStringToNull })}
            />
          </div>
          <div className="col-span-12">
            <label htmlFor={fieldId('note')} className={FIELD_LABEL_CLASS}>
              Нотатка (опц.)
            </label>
            <Input id={fieldId('note')} placeholder="—" {...register('note')} />
          </div>
        </div>
      </div>

      <ItemsList
        itemsArray={itemsArray}
        categories={categories}
        productNames={productNames}
        taxonomy={taxonomy}
      />

      {itemErrors?.root && <p className="text-sm text-red-600">{itemErrors.root.message}</p>}

      <SummaryFooter />

      {saveError && <ErrorDetails error={saveError} label="Помилка збереження" />}

      <div className="flex flex-wrap items-center gap-3">{actions}</div>
    </div>
  );
}
