import { useMemo, useState, type FormEvent } from 'react';
import { FormProvider, useWatch } from 'react-hook-form';
import { useNavigate } from '@tanstack/react-router';
import {
  todayIso,
  explainPairs,
  type DetectedItem,
  type ParsedReceipt,
  type PairDetectionResult,
} from '@finance-tracker/domain';
import { Button } from '@/shared/ui/Button';
import { useAppUsers } from '@/features/auth';
import { useCategories } from '@/features/categories';
import { useProducts } from '@/features/products';
import {
  computeGrandTotal,
  DuplicateWarningBanner,
  ReceiptFormFields,
  SUPPORTED_CURRENCIES,
  useDuplicateReceipts,
  useReceiptForm,
  useSaveReceiptMutation,
  type ItemFormValues,
  type SupportedCurrency,
} from '@/features/receipts';
import { useSavePhotoReceiptMutation } from '../api/use-save-photo-receipt-mutation';

type Props = {
  parsed: ParsedReceipt;
  pairResult: PairDetectionResult;
  photoBlob?: Blob | null;
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
    store_product_code: it.product_code ?? null,
    category: it.category_suggestion ?? '',
    qty: it.qty,
    unit_price_orig: it.unit_price_orig,
    consumed_by: 'shared',
    note: it.pair_marker?.kind === 'cancelled' ? 'пробито випадково' : null,
    wasted_qty: 0,
    wasted_at: null,
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

/**
 * Render a receipt review/edit form prepopulated from parsed OCR results and AI-detected item pairs.
 *
 * The form lets the user inspect and adjust store/date/time/items, shows diagnostics and duplicate
 * candidates, and saves the receipt either with an attached photo blob or as a non-photo receipt.
 *
 * @param parsed - The OCR-parsed receipt data used to prefill form fields and diagnostics
 * @param pairResult - AI pair-detection results used to build initial item rows
 * @param photoBlob - Optional photo blob; when provided the form will save the photo with the receipt
 * @param onCancel - Callback invoked when the user cancels the form
 * @param onSaved - Optional callback invoked with the saved `receipt_id` after a successful save
 * @returns The rendered JSX element containing the receipt review form
 */
export function PhotoReviewForm({ parsed, pairResult, photoBlob, onCancel, onSaved }: Props) {
  const navigate = useNavigate();
  const categoriesQuery = useCategories();
  const productsQuery = useProducts();
  const appUsersQuery = useAppUsers();
  const savePhoto = useSavePhotoReceiptMutation();
  const saveReceipt = useSaveReceiptMutation();

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
    time: parsed.time ?? null,
    store: parsed.store ?? '',
    store_address: parsed.store_address ?? null,
    currency: toFormCurrency(parsed.currency),
    source: 'photo',
    note: null,
    photo_url: null,
    raw_ocr_json: stringifyForOcr(parsed),
    items: initialItems,
  });

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
    const receipt = {
      date: values.date,
      time: values.time ?? null,
      store: values.store,
      store_address: values.store_address ?? null,
      currency: values.currency,
      paid_by: values.paid_by,
      source: 'photo' as const,
      note: values.note ?? null,
      raw_ocr_json: values.raw_ocr_json ?? null,
    };
    const items = values.items.map((it) => ({
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
    }));

    const result = photoBlob
      ? await savePhoto.mutateAsync({ receipt, items, photoBlob })
      : await saveReceipt.mutateAsync({
          receipt: { ...receipt, photo_url: null },
          items,
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

  const rawItemCount = parsed.items.length;
  const detectedCount = pairResult.items.length;
  const groupedPairs = rawItemCount - detectedCount;
  const diagnostics = useMemo(() => explainPairs(parsed.items), [parsed.items]);
  const isSaving = savePhoto.isPending || saveReceipt.isPending;
  const saveError = savePhoto.isError
    ? savePhoto.error
    : saveReceipt.isError
      ? saveReceipt.error
      : null;

  return (
    <FormProvider {...methods}>
      <form onSubmit={handleFormSubmit} className="space-y-4">
        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <div>
            AI розпізнав {rawItemCount}{' '}
            {rawItemCount === 1 ? 'позицію' : rawItemCount < 5 ? 'позиції' : 'позицій'}
            {groupedPairs > 0
              ? `, автоматично згруповано ${groupedPairs} ${groupedPairs === 1 ? 'пару' : groupedPairs < 5 ? 'пари' : 'пар'} (cancellation/discount)`
              : '. Пар не знайдено'}
            .
          </div>
          <details>
            <summary className="cursor-pointer text-slate-700 underline">
              Debug: показати raw AI output + normalize-ключі
            </summary>
            <div className="mt-2 space-y-2">
              <div className="text-slate-700">
                Кожен рядок — як AI повернув + ключ після normalize() + розмір групи. Pair-detector
                групує тільки коли два рядки мають однаковий ключ (group_size = 2). Якщо ключі різні
                — назви не збігаються після нормалізації; якщо group_size ≥ 3 — детектор
                консервативно пропускає.
              </div>
              <pre className="overflow-x-auto rounded-sm bg-white p-2 text-[11px] leading-tight">
                {JSON.stringify(diagnostics, null, 2)}
              </pre>
              <div className="text-slate-700">Сирий ParsedReceipt.items:</div>
              <pre className="overflow-x-auto rounded-sm bg-white p-2 text-[11px] leading-tight">
                {JSON.stringify(parsed.items, null, 2)}
              </pre>
            </div>
          </details>
        </div>
        <DuplicateWarningBanner
          candidates={visibleDuplicates}
          onDismiss={() => setDuplicatesDismissed(true)}
        />
        <ReceiptFormFields
          itemsArray={itemsArray}
          categories={categoryNames}
          productNames={productNames}
          paidByOptions={paidByOptions}
          saveError={saveError}
          actions={
            <>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? 'Зберігаю...' : 'Зберегти'}
              </Button>
              <Button variant="ghost" type="button" onClick={onCancel} disabled={isSaving}>
                Скасувати
              </Button>
            </>
          }
        />
      </form>
    </FormProvider>
  );
}
