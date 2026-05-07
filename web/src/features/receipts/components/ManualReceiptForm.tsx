import type { FormEvent } from 'react';
import { FormProvider } from 'react-hook-form';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/shared/ui/Button';
import { Input } from '@/shared/ui/Input';
import { useCategories } from '@/features/categories';
import { useProducts } from '@/features/products';
import { useReceiptForm } from '../hooks/use-receipt-form';
import { useSaveReceiptMutation } from '../api/use-save-receipt-mutation';
import { ItemsList } from './ItemsList';
import { SummaryFooter } from './SummaryFooter';
import { SUPPORTED_CURRENCIES } from '../schemas/manual-form';

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900';

const FIELD_LABEL_CLASS = 'text-xs font-medium text-slate-600';

export function ManualReceiptForm() {
  const { methods, itemsArray } = useReceiptForm();
  const categoriesQuery = useCategories();
  const productsQuery = useProducts();
  const save = useSaveReceiptMutation();
  const navigate = useNavigate();

  const categoryNames = categoriesQuery.data?.map((c) => c.name) ?? [];
  const productNames = productsQuery.data?.map((p) => p.name) ?? [];

  const onSubmit = methods.handleSubmit(async (values) => {
    const result = await save.mutateAsync({
      receipt: {
        date: values.date,
        store: values.store,
        currency: values.currency,
        paid_by: values.paid_by,
        source: values.source,
        note: values.note ?? null,
        photo_url: values.photo_url ?? null,
        raw_ocr_json: values.raw_ocr_json ?? null,
      },
      items: values.items.map((it) => ({
        product_id: it.product_id ?? null,
        product_name: it.product_name,
        category: it.category,
        qty: it.qty,
        unit_price_orig: it.unit_price_orig,
        consumed_by: it.consumed_by,
        note: it.note ?? null,
        wasted_qty: it.wasted_qty ?? 0,
        discount_orig: it.discount_orig ?? 0,
      })),
    });
    void navigate({ to: '/', search: { saved: result.receipt_id } });
  });

  const handleFormSubmit = (e: FormEvent<HTMLFormElement>) => {
    void onSubmit(e);
  };

  const errors = methods.formState.errors;

  return (
    <FormProvider {...methods}>
      <form onSubmit={handleFormSubmit} className="space-y-4">
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-6 sm:col-span-3">
              <label className={FIELD_LABEL_CLASS}>Дата</label>
              <Input type="date" {...methods.register('date')} />
              {errors.date && <span className="text-xs text-red-600">{errors.date.message}</span>}
            </div>
            <div className="col-span-12 sm:col-span-5">
              <label className={FIELD_LABEL_CLASS}>Магазин / опис</label>
              <Input placeholder="Lidl, Amazon, оренда..." {...methods.register('store')} />
              {errors.store && <span className="text-xs text-red-600">{errors.store.message}</span>}
            </div>
            <div className="col-span-6 sm:col-span-2">
              <label className={FIELD_LABEL_CLASS}>Валюта</label>
              <select className={SELECT_CLASS} {...methods.register('currency')}>
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-12 sm:col-span-2">
              <label className={FIELD_LABEL_CLASS}>Оплатив</label>
              <Input type="email" autoComplete="email" {...methods.register('paid_by')} />
            </div>
            <div className="col-span-12">
              <label className={FIELD_LABEL_CLASS}>Нотатка (опц.)</label>
              <Input placeholder="—" {...methods.register('note')} />
            </div>
          </div>
        </div>

        <ItemsList itemsArray={itemsArray} categories={categoryNames} productNames={productNames} />

        {errors.items?.root && <p className="text-sm text-red-600">{errors.items.root.message}</p>}

        <SummaryFooter />

        {save.isError && (
          <p role="alert" className="text-sm text-red-600">
            Помилка збереження: {save.error.message}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Зберігаю...' : 'Зберегти'}
          </Button>
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              void navigate({ to: '/' });
            }}
          >
            Скасувати
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}
