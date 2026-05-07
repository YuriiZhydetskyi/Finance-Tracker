import { useMemo, useState, type FormEvent } from 'react';
import { FormProvider } from 'react-hook-form';
import { useNavigate } from '@tanstack/react-router';
import {
  todayIso,
  type ParsedItem,
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
import { CancellationCard } from './CancellationCard';

type Cancellation = PairDetectionResult['cancellations'][number];

type Props = {
  parsed: ParsedReceipt;
  pairResult: PairDetectionResult;
  photoBlob: Blob;
  onCancel: () => void;
};

const RAW_OCR_MAX = 45_000;

function toFormCurrency(currency: string | null | undefined): SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(currency ?? '')
    ? (currency as SupportedCurrency)
    : 'EUR';
}

function parsedItemToFormRow(it: ParsedItem): ItemFormValues {
  return {
    product_id: null,
    product_name: it.product_name,
    category: it.category_suggestion ?? '',
    qty: it.qty,
    unit_price_orig: it.unit_price_orig,
    consumed_by: 'shared',
    note: null,
    wasted_qty: 0,
    discount_orig: it.discount_orig ?? 0,
  };
}

function cancellationToFormRow(c: Cancellation): ItemFormValues {
  return {
    product_id: null,
    product_name: c.product_name,
    category: c.category_suggestion ?? '',
    qty: c.qty,
    unit_price_orig: c.unit_price_orig,
    consumed_by: 'shared',
    note: null,
    wasted_qty: 0,
    discount_orig: 0,
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

export function PhotoReviewForm({ parsed, pairResult, photoBlob, onCancel }: Props) {
  const navigate = useNavigate();
  const categoriesQuery = useCategories();
  const productsQuery = useProducts();
  const save = useSavePhotoReceiptMutation();

  const initialItems = useMemo(
    () =>
      pairResult.items.length > 0
        ? pairResult.items.map(parsedItemToFormRow)
        : [
            parsedItemToFormRow({
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

  const [includedCancellations, setIncludedCancellations] = useState<Set<number>>(new Set());

  const categoryNames = categoriesQuery.data?.map((c) => c.name) ?? [];
  const productNames = productsQuery.data?.map((p) => p.name) ?? [];
  const currentCurrency = methods.watch('currency');

  const handleToggleCancellation = (index: number, included: boolean) => {
    setIncludedCancellations((prev) => {
      const next = new Set(prev);
      if (included) next.add(index);
      else next.delete(index);
      return next;
    });
  };

  const onSubmit = methods.handleSubmit(async (values) => {
    const extraItems = pairResult.cancellations
      .filter((_, i) => includedCancellations.has(i))
      .map(cancellationToFormRow);

    const allItems = [...values.items, ...extraItems];

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
      items: allItems.map((it) => ({
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

    void navigate({ to: '/recent', search: { saved: result.receipt_id } });
  });

  const handleFormSubmit = (e: FormEvent<HTMLFormElement>) => {
    void onSubmit(e);
  };

  return (
    <FormProvider {...methods}>
      <form onSubmit={handleFormSubmit} className="space-y-4">
        {pairResult.cancellations.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-amber-700">
              Скасування / повернення ({pairResult.cancellations.length})
            </h2>
            <p className="text-xs text-slate-600">
              Знайдено пари «купив + повернув» з однаковою сумою. За замовчуванням не зберігаються.
            </p>
            <div className="space-y-2">
              {pairResult.cancellations.map((c, i) => (
                <CancellationCard
                  key={`${c.product_name}-${String(i)}`}
                  cancellation={c}
                  index={i}
                  included={includedCancellations.has(i)}
                  onToggle={handleToggleCancellation}
                  currency={currentCurrency}
                />
              ))}
            </div>
          </section>
        )}

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
