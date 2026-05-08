import type { FormEvent } from 'react';
import { FormProvider } from 'react-hook-form';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/shared/ui/Button';
import { useAppUsers } from '@/features/auth';
import { useCategories } from '@/features/categories';
import { useProducts } from '@/features/products';
import { useReceiptForm } from '../hooks/use-receipt-form';
import { useSaveReceiptMutation } from '../api/use-save-receipt-mutation';
import { ReceiptFormFields } from './ReceiptFormFields';

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
    void navigate({ to: '/recent', search: { saved: result.receipt_id } });
  });

  const handleFormSubmit = (e: FormEvent<HTMLFormElement>) => {
    void onSubmit(e);
  };

  return (
    <FormProvider {...methods}>
      <form onSubmit={handleFormSubmit}>
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
