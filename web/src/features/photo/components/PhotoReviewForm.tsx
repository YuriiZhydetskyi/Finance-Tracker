import { useMemo, type FormEvent } from 'react';
import { FormProvider } from 'react-hook-form';
import { useNavigate } from '@tanstack/react-router';
import {
  todayIso,
  type DetectedItem,
  type ParsedReceipt,
  type PairDetectionResult,
} from '@finance-tracker/domain';
import { Button } from '@/shared/ui/Button';
import { useCategories } from '@/features/categories';
import { useProducts } from '@/features/products';
import {
  ReceiptFormFields,
  SUPPORTED_CURRENCIES,
  useReceiptForm,
  type ItemFormValues,
  type SupportedCurrency,
} from '@/features/receipts';
import { useSavePhotoReceiptMutation } from '../api/use-save-photo-receipt-mutation';

type Props = {
  parsed: ParsedReceipt;
  pairResult: PairDetectionResult;
  photoBlob: Blob;
  onCancel: () => void;
  onSaved?: (receipt_id: string) => void;
};

const RAW_OCR_MAX = 45_000;

function toFormCurrency(currency: string | null | undefined): SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(currency ?? '')
    ? (currency as SupportedCurrency)
    : 'EUR';
}

function detectedItemToFormRow(it: DetectedItem): ItemFormValues {
  return {
    product_id: null,
    product_name: it.product_name,
    category: it.category_suggestion ?? '',
    qty: it.qty,
    unit_price_orig: it.unit_price_orig,
    consumed_by: 'shared',
    note: it.pair_marker?.kind === 'cancelled' ? 'пробито випадково' : null,
    wasted_qty: 0,
    discount_orig: it.discount_orig ?? 0,
    ...(it.pair_marker ? { pair_marker: it.pair_marker } : {}),
  };
}

function stringifyForOcr(parsed: ParsedReceipt): string | null {
  try {
    const json = JSON.stringify(parsed);
    return json.length <= RAW_OCR_MAX ? json : null;
  } catch {
    return null;
  }
}

export function PhotoReviewForm({ parsed, pairResult, photoBlob, onCancel, onSaved }: Props) {
  const navigate = useNavigate();
  const categoriesQuery = useCategories();
  const productsQuery = useProducts();
  const save = useSavePhotoReceiptMutation();

  const initialItems = useMemo(
    () =>
      pairResult.items.length > 0
        ? pairResult.items.map(detectedItemToFormRow)
        : [
            detectedItemToFormRow({
              product_name: '',
              qty: 1,
              unit_price_orig: 0,
              category_suggestion: null,
            }),
          ],
    [pairResult.items],
  );

  const { methods, itemsArray } = useReceiptForm({
    date: parsed.date ?? todayIso(),
    store: parsed.store ?? '',
    currency: toFormCurrency(parsed.currency),
    source: 'photo',
    note: null,
    photo_url: null,
    raw_ocr_json: stringifyForOcr(parsed),
    items: initialItems,
  });

  const categoryNames = categoriesQuery.data?.map((c) => c.name) ?? [];
  const productNames = productsQuery.data?.map((p) => p.name) ?? [];

  const onSubmit = methods.handleSubmit(async (values) => {
    const result = await save.mutateAsync({
      receipt: {
        date: values.date,
        store: values.store,
        currency: values.currency,
        paid_by: values.paid_by,
        source: 'photo',
        note: values.note ?? null,
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
      photoBlob,
    });

    if (onSaved) {
      onSaved(result.receipt_id);
    } else {
      void navigate({ to: '/recent', search: { saved: result.receipt_id } });
    }
  });

  const handleFormSubmit = (e: FormEvent<HTMLFormElement>) => {
    void onSubmit(e);
  };

  return (
    <FormProvider {...methods}>
      <form onSubmit={handleFormSubmit} className="space-y-4">
        <ReceiptFormFields
          itemsArray={itemsArray}
          categories={categoryNames}
          productNames={productNames}
          saveError={save.isError ? save.error : null}
          actions={
            <>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? 'Зберігаю...' : 'Зберегти'}
              </Button>
              <Button variant="ghost" type="button" onClick={onCancel} disabled={save.isPending}>
                Скасувати
              </Button>
            </>
          }
        />
      </form>
    </FormProvider>
  );
}
