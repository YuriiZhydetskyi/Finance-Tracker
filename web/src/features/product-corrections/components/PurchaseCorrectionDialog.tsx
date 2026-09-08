import { useEffect, useRef, useState } from 'react';
import { useCategories } from '@/features/categories';
import { useProductTaxonomy } from '@/features/products/api/use-products';
import { Button } from '@/shared/ui/Button';
import { ErrorDetails } from '@/shared/ui/ErrorDetails';
import { Input } from '@/shared/ui/Input';
import { FIELD_LABEL_CLASS, SELECT_CLASS } from '@/shared/ui/select-classes';
import {
  type CorrectablePurchase,
  useCorrectablePurchase,
  usePurchaseCorrectionMutation,
} from '../api/use-purchase-correction';

type Props = Readonly<{
  itemId: string;
  onClose: () => void;
}>;

function nullable(value: string): string | null {
  return value === '' ? null : value;
}

/**
 * Corrects one historical purchase without changing its price, quantity or
 * OCR evidence. A checked rule applies only to the same normalized store and
 * the same normalized printed label on later imports.
 */
export function PurchaseCorrectionDialog({ itemId, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const purchaseQuery = useCorrectablePurchase(itemId);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
      aria-labelledby="purchase-correction-title"
      className="rounded-md border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/50"
    >
      <div className="w-[min(92vw,580px)] space-y-4 p-5">
        <div>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="purchase-correction-title" className="text-lg font-semibold">
                Виправити товар у покупці
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Сума, кількість і початковий текст чека не зміняться.
              </p>
            </div>
            <Button variant="ghost" className="h-8 px-2" onClick={onClose} disabled={saving}>
              Закрити
            </Button>
          </div>
        </div>

        {purchaseQuery.isLoading && <p className="text-sm text-slate-600">Завантажую покупку…</p>}
        {purchaseQuery.isError && (
          <ErrorDetails error={purchaseQuery.error} label="Не вдалося завантажити покупку" />
        )}
        {!purchaseQuery.isLoading && !purchaseQuery.isError && !purchaseQuery.data && (
          <p className="text-sm text-red-600">Покупку не знайдено або доступ до неї втрачено.</p>
        )}
        {purchaseQuery.data && (
          <PurchaseCorrectionForm
            key={purchaseQuery.data.id}
            purchase={purchaseQuery.data}
            onClose={onClose}
            onSavingChange={setSaving}
          />
        )}
      </div>
    </dialog>
  );
}

function PurchaseCorrectionForm({
  purchase,
  onClose,
  onSavingChange,
}: Readonly<{
  purchase: CorrectablePurchase;
  onClose: () => void;
  onSavingChange: (saving: boolean) => void;
}>) {
  const categoriesQuery = useCategories();
  const taxonomyQuery = useProductTaxonomy();
  const correction = usePurchaseCorrectionMutation();
  const [productName, setProductName] = useState(purchase.product_name);
  const [category, setCategory] = useState(purchase.category);
  const [familyId, setFamilyId] = useState(purchase.product_family_id ?? '');
  const [variantId, setVariantId] = useState(purchase.product_variant_id ?? '');
  const [rememberRule, setRememberRule] = useState(false);
  const taxonomy = taxonomyQuery.data ?? { families: [], variants: [] };
  const variants = taxonomy.variants.filter((variant) => variant.family_id === familyId);
  const pending = correction.isPending;
  const dataReady =
    !categoriesQuery.isLoading &&
    !taxonomyQuery.isLoading &&
    !categoriesQuery.isError &&
    !taxonomyQuery.isError;
  const canSubmit = Boolean(productName.trim() && category && dataReady);

  const submit = () => {
    if (!canSubmit) return;
    onSavingChange(true);
    correction.mutate(
      {
        itemId: purchase.id,
        receiptId: purchase.receipt_id,
        productName,
        category,
        productFamilyId: nullable(familyId),
        productVariantId: nullable(variantId),
        rememberRule,
      },
      {
        onSuccess: onClose,
        onSettled: () => onSavingChange(false),
      },
    );
  };

  return (
    <>
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
        <div>
          У чеку: <span className="font-medium">{purchase.raw_product_name}</span>
        </div>
        <div className="text-slate-600">
          {purchase.receipt.store} · {purchase.receipt.date}
          {purchase.receipt.time ? ` · ${purchase.receipt.time.slice(0, 5)}` : ''}
        </div>
      </div>
      {categoriesQuery.isError && (
        <ErrorDetails error={categoriesQuery.error} label="Не вдалося завантажити категорії" />
      )}
      {taxonomyQuery.isError && (
        <ErrorDetails error={taxonomyQuery.error} label="Не вдалося завантажити типи товарів" />
      )}

      <div>
        <label className={FIELD_LABEL_CLASS} htmlFor="purchase-correction-name">
          Назва товару
        </label>
        <Input
          id="purchase-correction-name"
          value={productName}
          onChange={(event) => setProductName(event.target.value)}
          disabled={pending}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={FIELD_LABEL_CLASS} htmlFor="purchase-correction-category">
            Категорія
          </label>
          <select
            id="purchase-correction-category"
            className={SELECT_CLASS}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            disabled={pending || categoriesQuery.isLoading}
          >
            <option value="">Оберіть категорію</option>
            {(categoriesQuery.data ?? []).map((entry) => (
              <option key={entry.name} value={entry.name}>
                {entry.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={FIELD_LABEL_CLASS} htmlFor="purchase-correction-family">
            Тип товару
          </label>
          <select
            id="purchase-correction-family"
            className={SELECT_CLASS}
            value={familyId}
            onChange={(event) => {
              setFamilyId(event.target.value);
              setVariantId('');
            }}
            disabled={pending || taxonomyQuery.isLoading}
          >
            <option value="">Невідомо</option>
            {taxonomy.families.map((family) => (
              <option key={family.id} value={family.id}>
                {family.name_uk} · {family.name_de}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={FIELD_LABEL_CLASS} htmlFor="purchase-correction-variant">
            Різновид
          </label>
          <select
            id="purchase-correction-variant"
            className={SELECT_CLASS}
            value={variantId}
            onChange={(event) => setVariantId(event.target.value)}
            disabled={pending || !familyId || taxonomyQuery.isLoading}
          >
            <option value="">Без деталізації</option>
            {variants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.name_uk} · {variant.name_de}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 p-3 text-sm">
        <input
          type="checkbox"
          checked={rememberRule}
          onChange={(event) => setRememberRule(event.target.checked)}
          disabled={pending}
          className="mt-0.5"
        />
        <span>
          Запам’ятати для цього магазину: «{purchase.raw_product_name}» → «
          {productName.trim() || '…'}». Правило не застосовується до інших магазинів.
        </span>
      </label>
      {correction.isError && (
        <ErrorDetails error={correction.error} label="Не вдалося зберегти виправлення" />
      )}
      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Скасувати
        </Button>
        <Button onClick={submit} disabled={!canSubmit || pending}>
          {pending ? 'Зберігаю…' : 'Зберегти виправлення'}
        </Button>
      </div>
    </>
  );
}
