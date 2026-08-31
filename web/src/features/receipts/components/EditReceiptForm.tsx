import { useState, type FormEvent } from 'react';
import { FormProvider } from 'react-hook-form';
import { useNavigate } from '@tanstack/react-router';
import type { Item, Receipt } from '@finance-tracker/domain';
import { Button } from '@/shared/ui/Button';
import { useAppUsers } from '@/features/auth';
import { useCategories } from '@/features/categories';
import { useProducts } from '@/features/products';
import { useReceiptForm, emptyItemRow } from '../hooks/use-receipt-form';
import { useUpdateReceiptMutation } from '../api/use-update-receipt-mutation';
import { useDeleteReceiptMutation } from '../api/use-delete-receipt-mutation';
import {
  SUPPORTED_CURRENCIES,
  type ItemFormValues,
  type ManualFormValues,
  type SupportedCurrency,
} from '../schemas/manual-form';
import { ReceiptFormFields } from './ReceiptFormFields';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';

type Props = {
  receipt: Receipt;
  items: Item[];
};

function toFormCurrency(currency: string): SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(currency)
    ? (currency as SupportedCurrency)
    : 'EUR';
}

function toFormRow(item: Item): ItemFormValues {
  return {
    product_id: item.product_id,
    product_name: item.product_name,
    store_product_code: item.store_product_code,
    category: item.category,
    qty: item.qty,
    unit_price_orig: item.unit_price_orig,
    consumed_by: item.consumed_by,
    note: item.note,
    wasted_qty: item.wasted_qty,
    // Preserve wasted_at on re-save: /edit shouldn't touch the spoilage
    // timestamp of items the user is just adjusting category/note for.
    wasted_at: item.wasted_at,
    discount_orig: item.discount_orig,
  };
}

export function EditReceiptForm({ receipt, items }: Props) {
  const navigate = useNavigate();
  const categoriesQuery = useCategories();
  const productsQuery = useProducts();
  const appUsersQuery = useAppUsers();
  const update = useUpdateReceiptMutation();
  const remove = useDeleteReceiptMutation();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { methods, itemsArray } = useReceiptForm({
    date: receipt.date,
    // Form input accepts HH:MM only; DB stores HH:MM:SS. Slice for display.
    time: receipt.time ? receipt.time.slice(0, 5) : null,
    store: receipt.store,
    store_address: receipt.store_address,
    currency: toFormCurrency(receipt.currency),
    paid_by: receipt.paid_by,
    source: receipt.source,
    note: receipt.note,
    photo_url: receipt.photo_url,
    photo_path: receipt.photo_path,
    raw_ocr_json: receipt.raw_ocr_json,
    items: items.length > 0 ? items.map(toFormRow) : [emptyItemRow()],
  });

  const categoryNames = categoriesQuery.data?.map((c) => c.name) ?? [];
  const productNames = productsQuery.data?.map((p) => p.name) ?? [];
  const allowlistEmails = appUsersQuery.data ?? [];
  // Preserve a legacy paid_by value (e.g. someone removed from the allowlist)
  // so editing an old receipt doesn't silently rewrite who paid.
  const paidByOptions = allowlistEmails.includes(receipt.paid_by)
    ? allowlistEmails
    : [...allowlistEmails, receipt.paid_by];

  const onSubmit = methods.handleSubmit(async (values: ManualFormValues) => {
    await update.mutateAsync({
      id: receipt.id,
      existing: receipt,
      receipt: {
        date: values.date,
        time: values.time ?? null,
        store: values.store,
        store_address: values.store_address ?? null,
        currency: values.currency,
        paid_by: values.paid_by,
        source: values.source,
        note: values.note ?? null,
        photo_url: values.photo_url ?? null,
        photo_path: values.photo_path ?? null,
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
        wasted_at: it.wasted_at ?? null,
        discount_orig: it.discount_orig ?? 0,
      })),
    });
    void navigate({ to: '/recent', search: { saved: receipt.id } });
  });

  const handleFormSubmit = (e: FormEvent<HTMLFormElement>) => {
    void onSubmit(e);
  };

  const handleConfirmDelete = () => {
    void (async () => {
      try {
        await remove.mutateAsync({ id: receipt.id });
        setConfirmOpen(false);
        void navigate({ to: '/recent' });
      } catch {
        setConfirmOpen(false);
      }
    })();
  };

  const busy = update.isPending || remove.isPending;

  return (
    <FormProvider {...methods}>
      <form onSubmit={handleFormSubmit}>
        <ReceiptFormFields
          itemsArray={itemsArray}
          categories={categoryNames}
          productNames={productNames}
          paidByOptions={paidByOptions}
          saveError={update.isError ? update.error : remove.isError ? remove.error : null}
          actions={
            <>
              <Button type="submit" disabled={busy}>
                {update.isPending ? 'Зберігаю...' : 'Зберегти'}
              </Button>
              <Button
                variant="ghost"
                type="button"
                onClick={() => {
                  void navigate({ to: '/recent' });
                }}
                disabled={busy}
              >
                Скасувати
              </Button>
              <Button
                variant="danger"
                type="button"
                onClick={() => setConfirmOpen(true)}
                disabled={busy}
                className="ml-auto"
              >
                Видалити
              </Button>
            </>
          }
        />
      </form>

      <DeleteConfirmDialog
        open={confirmOpen}
        pending={remove.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirmDelete}
      />
    </FormProvider>
  );
}
