import type { ChangeEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Input } from '@/shared/ui/Input';
import { FIELD_LABEL_CLASS, SELECT_CLASS } from '@/shared/ui/select-classes';
import { useDebouncedUrlDraft } from '@/shared/hooks/use-debounced-url-draft';
import type { WasteSearchInput } from '../waste-search';

type Props = {
  search: WasteSearchInput;
  categoryOptions: string[];
  activeCount: number;
};

export function WasteFiltersBar({ search, categoryOptions, activeCount }: Props) {
  const navigate = useNavigate();

  const [nameDraft, setNameDraft] = useDebouncedUrlDraft({
    value: search.q,
    onCommit: (q) => void navigate({ to: '/waste', search: { ...search, q } }),
  });
  const [storeDraft, setStoreDraft] = useDebouncedUrlDraft({
    value: search.store,
    onCommit: (store) => void navigate({ to: '/waste', search: { ...search, store } }),
  });

  const update = (patch: Partial<WasteSearchInput>) => {
    void navigate({ to: '/waste', search: { ...search, ...patch } });
  };

  const clearAll = () => void navigate({ to: '/waste', search: {} });

  const onNumber = (key: 'min' | 'max') => (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    update({ [key]: v === '' ? undefined : Number(v) });
  };

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
      <div className="grid grid-cols-12 gap-2">
        <div className="col-span-12 sm:col-span-4">
          <label className={FIELD_LABEL_CLASS} htmlFor="waste-filter-name">
            Назва товару
          </label>
          <Input
            id="waste-filter-name"
            placeholder="яблуко, Apfel, apple…"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            aria-describedby="waste-search-help"
          />
          <p id="waste-search-help" className="mt-1 text-xs text-slate-500">
            Назва, вид або бренд — українською, німецькою чи англійською.
          </p>
        </div>
        <div className="col-span-12 sm:col-span-3">
          <label className={FIELD_LABEL_CLASS} htmlFor="waste-filter-category">
            Категорія
          </label>
          <select
            id="waste-filter-category"
            className={SELECT_CLASS}
            value={search.category ?? ''}
            onChange={(e) => update({ category: e.target.value || undefined })}
          >
            <option value="">Усі</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-12 sm:col-span-5">
          <label className={FIELD_LABEL_CLASS} htmlFor="waste-filter-store">
            Магазин
          </label>
          <Input
            id="waste-filter-store"
            placeholder="Lidl, Aldi…"
            value={storeDraft}
            onChange={(e) => setStoreDraft(e.target.value)}
          />
        </div>
        <div className="col-span-6 sm:col-span-3">
          <label className={FIELD_LABEL_CLASS} htmlFor="waste-filter-from">
            З дати
          </label>
          <Input
            id="waste-filter-from"
            type="date"
            value={search.from ?? ''}
            onChange={(e) => update({ from: e.target.value || undefined })}
          />
        </div>
        <div className="col-span-6 sm:col-span-3">
          <label className={FIELD_LABEL_CLASS} htmlFor="waste-filter-to">
            По дату
          </label>
          <Input
            id="waste-filter-to"
            type="date"
            value={search.to ?? ''}
            onChange={(e) => update({ to: e.target.value || undefined })}
          />
        </div>
        <div className="col-span-6 sm:col-span-3">
          <label className={FIELD_LABEL_CLASS} htmlFor="waste-filter-min">
            Мін ціна
          </label>
          <Input
            id="waste-filter-min"
            type="number"
            step="0.01"
            min="0"
            value={search.min ?? ''}
            onChange={onNumber('min')}
          />
        </div>
        <div className="col-span-6 sm:col-span-3">
          <label className={FIELD_LABEL_CLASS} htmlFor="waste-filter-max">
            Макс ціна
          </label>
          <Input
            id="waste-filter-max"
            type="number"
            step="0.01"
            min="0"
            value={search.max ?? ''}
            onChange={onNumber('max')}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={search.showAll ?? false}
            onChange={(e) => update({ showAll: e.target.checked ? true : undefined })}
            className="h-4 w-4 rounded border-slate-300"
          />
          Показати повністю списані
        </label>
        {activeCount > 0 && (
          <div className="flex items-center gap-3">
            <span>
              Активні фільтри: <span className="font-medium">{activeCount}</span>
            </span>
            <button type="button" onClick={clearAll} className="underline hover:no-underline">
              Очистити все
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
