import { useMemo, useState, type FormEvent } from 'react';
import { FormProvider, useWatch } from 'react-hook-form';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/shared/ui/Button';
import { useAppUsers } from '@/features/auth';
import { useCategories } from '@/features/categories';
import { useProducts } from '@/features/products';
import { useReceiptForm } from '../hooks/use-receipt-form';
import { useSaveReceiptMutation } from '../api/use-save-receipt-mutation';
import { useDuplicateReceipts } from '../api/use-duplicate-receipts';
import { computeGrandTotal } from '../utils/totals';
import { ReceiptFormFields } from './ReceiptFormFields';
import { DuplicateWarningBanner } from './DuplicateWarningBanner';

export function ManualReceiptForm() {
  const { methods, itemsArray } = useReceiptForm();
  const categoriesQuery = useCategories();
  const productsQuery = useProducts();
  const appUsersQuery = useAppUsers();
  const save = useSaveReceiptMutation();
  const navigate = useNavigate();

  const categoryNames = categoriesQuery.data?.map((c) => c.name) ?? [];
  const productNames = productsQuery.data?.map((p) => p.name) ?? [];
  const paidByOptions = appUsersQuery.data ?? [];

  const watchedStore = useWatch({ control: methods.control, name: 'store' });
  const watchedDate = useWatch({ control: methods.control, name: 'date' });
  const watchedTime = useWatch({ control: methods.control, name: 'time' });
  const watchedItems = useWatch({ control: methods.control, name: 'items' });
  const watchedTotal = useMemo(() => computeGrandTotal(watchedItems ?? []), [watchedItems]);
  const [duplicatesDismissed, setDuplicatesDismissed] = useState(false);
  const duplicatesQuery = useDuplicateReceipts({
    store: watchedStore,
    date: watchedDate,
    time: watchedTime,
    total_orig: watchedTotal,
  });
  const visibleDuplicates = duplicatesDismissed ? [] : (duplicatesQuery.data ?? []);

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
        store_product_code: it.store_product_code ?? null,
        category: it.category,
        qty: it.qty,
        unit_price_orig: it.unit_price_orig,
        consumed_by: it.consumed_by,
        note: it.note ?? null,
        wasted_qty: it.wasted_qty ?? 0,
        discount_orig: it.discount_orig ?? 0,
      })),
    });
    void navigate({ to: '/recent', search: { saved: result.receipt_id } });
  });

  const handleFormSubmit = (e: FormEvent<HTMLFormElement>) => {
    void onSubmit(e);
  };

  return (
    <FormProvider {...methods}>
      <form onSubmit={handleFormSubmit} className="space-y-4">
        <DuplicateWarningBanner
          candidates={visibleDuplicates}
          onDismiss={() => setDuplicatesDismissed(true)}
        />
        <ReceiptFormFields
          itemsArray={itemsArray}
          categories={categoryNames}
          productNames={productNames}
          paidByOptions={paidByOptions}
          saveError={save.isError ? save.error : null}
          actions={
            <>
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
            </>
          }
        />
      </form>
    </FormProvider>
  );
}
