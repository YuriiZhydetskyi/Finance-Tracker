import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import type { StatementTransaction } from '@finance-tracker/domain';
import { useCategories } from '@/features/categories';
import { Button } from '@/shared/ui/Button';
import { Input } from '@/shared/ui/Input';
import { SELECT_CLASS } from '@/shared/ui/select-classes';
import { ErrorDetails } from '@/shared/ui/ErrorDetails';
import { formatMoney } from '@/shared/utils/format-money';
import { formatDate } from '@/shared/utils/format-date';
import { useCreateStubReceiptMutation } from '../api/use-create-stub-receipt-mutation';
import { useResolveOrphanMutation } from '../api/use-resolve-orphan-mutation';
import { useSuggestedCategory } from '../api/use-suggested-category';

type Props = {
  // Null = closed. A non-null orphan opens the dialog prefilled from it.
  orphan: StatementTransaction | null;
  onClose: () => void;
  onCreated: () => void;
};

/**
 * Creates a detail-less "stub" receipt from an orphan card transaction (e.g. a
 * McDonald's charge whose paper receipt was never photographed). Records the
 * amount/store/date/payer with ONE catch-all line item so it shows up in every
 * stats view (the per-category view aggregates items, so a line is required).
 * On success the orphan is resolved (linked + status='receipt_created').
 *
 * The outer component owns the native <dialog> open/close; the form lives in a
 * child keyed by the orphan id so its fields re-seed via state initializers when
 * a different orphan opens it (no setState-in-effect).
 */
export function CreateStubReceiptDialog({ orphan, onClose, onCreated }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const open = orphan != null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === dialogRef.current) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={handleBackdropClick}
      aria-labelledby="stub-receipt-title"
      className="max-h-[92vh] w-[min(96vw,32rem)] rounded-md border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      {orphan && (
        <StubForm key={orphan.id} orphan={orphan} onClose={onClose} onCreated={onCreated} />
      )}
    </dialog>
  );
}

function StubForm({
  orphan,
  onClose,
  onCreated,
}: {
  orphan: StatementTransaction;
  onClose: () => void;
  onCreated: () => void;
}) {
  const categoriesQuery = useCategories();
  const suggestedCategory = useSuggestedCategory(orphan.merchant, orphan.raw);
  const saveReceipt = useCreateStubReceiptMutation();
  const resolveOrphan = useResolveOrphanMutation();

  const [store, setStore] = useState(orphan.merchant ?? orphan.raw ?? '');
  const [category, setCategory] = useState('');
  const [consumedBy, setConsumedBy] = useState('shared');
  const [error, setError] = useState<string | null>(null);

  // Suggestion priority: learned from history first, else the AI's guess captured
  // at import (only if it's a real category). The select falls back to it until the
  // user picks something (controlled-with-fallback — no setState in an effect when
  // the async suggestion arrives). An explicit pick wins.
  const categoryNames = useMemo(
    () => new Set((categoriesQuery.data ?? []).map((c) => c.name)),
    [categoriesQuery.data],
  );
  const historySuggestion = suggestedCategory.data ?? null;
  const llmSuggestion =
    orphan.suggested_category && categoryNames.has(orphan.suggested_category)
      ? orphan.suggested_category
      : null;
  const suggested = historySuggestion ?? llmSuggestion ?? '';
  const effectiveCategory = category || suggested;
  const isSuggested = category === '' && suggested !== '';

  const grouped = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const c of categoriesQuery.data ?? []) {
      const arr = map.get(c.group_name) ?? [];
      arr.push(c.name);
      map.set(c.group_name, arr);
    }
    return [...map.entries()];
  }, [categoriesQuery.data]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const trimmedStore = store.trim();
    if (!trimmedStore) {
      setError('Вкажи назву магазину.');
      return;
    }
    if (!effectiveCategory) {
      setError('Обери категорію.');
      return;
    }

    saveReceipt.mutate(
      {
        date: orphan.date,
        store: trimmedStore,
        currency: orphan.currency,
        paid_by: orphan.paid_by,
        time: orphan.time,
        amount_orig: orphan.amount_orig,
        category: effectiveCategory,
        consumed_by: consumedBy,
      },
      {
        onSuccess: (result) => {
          resolveOrphan.mutate(
            { id: orphan.id, receipt_id: result.receipt_id },
            { onSuccess: () => onCreated() },
          );
        },
      },
    );
  };

  const isSaving = saveReceipt.isPending || resolveOrphan.isPending;

  return (
    <form onSubmit={handleSubmit} className="flex max-h-[92vh] flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <h2 id="stub-receipt-title" className="text-base font-semibold text-slate-900">
          Створити чек без деталей
        </h2>
        <Button type="button" variant="ghost" onClick={onClose} className="px-3">
          Закрити
        </Button>
      </div>

      <div className="space-y-3 overflow-y-auto p-4">
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <div className="font-medium text-slate-900">
            {formatMoney(orphan.amount_orig, orphan.currency)}
          </div>
          <div>
            {formatDate(orphan.date)}
            {orphan.time ? ` · ${orphan.time.slice(0, 5)}` : ''} · картка: {orphan.paid_by}
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="stub-store" className="text-sm font-medium text-slate-800">
            Магазин
          </label>
          <Input
            id="stub-store"
            value={store}
            onChange={(e) => setStore(e.target.value)}
            placeholder="Напр. McDonald's"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="stub-category" className="text-sm font-medium text-slate-800">
            Категорія
          </label>
          <select
            id="stub-category"
            className={SELECT_CLASS}
            value={effectiveCategory}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">— обери категорію —</option>
            {grouped.map(([group, names]) => (
              <optgroup key={group} label={group}>
                {names.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {isSuggested && (
            <p className="text-xs text-slate-500">Підставлено автоматично — можна змінити.</p>
          )}
        </div>

        <div className="space-y-1">
          <label htmlFor="stub-consumed-by" className="text-sm font-medium text-slate-800">
            Хто спожив
          </label>
          <select
            id="stub-consumed-by"
            className={SELECT_CLASS}
            value={consumedBy}
            onChange={(e) => setConsumedBy(e.target.value)}
          >
            <option value="his">Він</option>
            <option value="hers">Вона</option>
            <option value="shared">Спільне</option>
          </select>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800"
          >
            {error}
          </div>
        )}
        {saveReceipt.isError && (
          <ErrorDetails error={saveReceipt.error} label="Не вдалося зберегти чек" />
        )}
        {resolveOrphan.isError && (
          <ErrorDetails
            error={resolveOrphan.error}
            label="Чек збережено, але не вдалося оновити список"
          />
        )}
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-3">
        <Button type="button" variant="ghost" onClick={onClose} disabled={isSaving}>
          Скасувати
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? 'Зберігаю…' : 'Створити чек'}
        </Button>
      </div>
    </form>
  );
}
