import type { SubmitEvent } from 'react';
import { FormProvider } from 'react-hook-form';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/shared/ui/Button';
import { useLeaveGuard } from '@/shared/hooks/use-leave-guard';
import { useAppUsers } from '@/features/auth';
import { useCategoryNames } from '@/features/categories';
import { useProductNames } from '@/features/products';
import { useProductTaxonomy } from '@/features/products/api/use-products';
import { useReceiptForm } from '../hooks/use-receipt-form';
import { useSaveReceiptMutation } from '../api/use-save-receipt-mutation';
import { ReceiptFormFields } from './ReceiptFormFields';
import { DuplicateReceiptsWarning } from './DuplicateReceiptsWarning';

export function ManualReceiptForm() {
  const { methods, itemsArray } = useReceiptForm();
  const categoryNames = useCategoryNames();
  const productNames = useProductNames();
  const taxonomyQuery = useProductTaxonomy();
  const appUsersQuery = useAppUsers();
  const save = useSaveReceiptMutation();
  const navigate = useNavigate();

  useLeaveGuard(methods.formState.isDirty);

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
        photo_path: values.photo_path ?? null,
        merchant_order_id: values.merchant_order_id ?? null,
        raw_ocr_json: values.raw_ocr_json ?? null,
      },
      items: values.items.map((it) => ({
        product_id: it.product_id ?? null,
        product_name: it.product_name,
        store_product_code: it.store_product_code ?? null,
        product_url: it.product_url ?? null,
        product_image_url: it.product_image_url ?? null,
        product_family_id: it.product_family_id ?? null,
        product_variant_id: it.product_variant_id ?? null,
        brand: it.brand ?? null,
        is_organic: it.is_organic ?? null,
        product_metadata_override: it.product_metadata_override ?? false,
        category: it.category,
        qty: it.qty,
        unit_price_orig: it.unit_price_orig,
        consumed_by: it.consumed_by,
        note: it.note ?? null,
        wasted_qty: it.wasted_qty ?? 0,
        wasted_at: it.wasted_at ?? null,
        discount_orig: it.discount_orig ?? 0,
      })),
    });
    void navigate({
      to: '/recent',
      search: { saved: result.receipt_id },
      ignoreBlocker: true,
    });
  });

  const handleFormSubmit = (e: SubmitEvent<HTMLFormElement>) => {
    void onSubmit(e);
  };

  return (
    <FormProvider {...methods}>
      <form onSubmit={handleFormSubmit} className="space-y-4">
        <DuplicateReceiptsWarning />
        <ReceiptFormFields
          itemsArray={itemsArray}
          categories={categoryNames}
          productNames={productNames}
          taxonomy={taxonomyQuery.data ?? { families: [], variants: [] }}
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
