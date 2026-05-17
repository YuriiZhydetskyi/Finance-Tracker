import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Input } from '@/shared/ui/Input';
import { FIELD_LABEL_CLASS, SELECT_CLASS } from '@/shared/ui/select-classes';
import { useDebounce } from '@/shared/hooks/use-debounce';
import type { RecentSearchInput } from '../recent-search';

type Props = {
  search: RecentSearchInput;
  paidByOptions: string[];
  activeCount: number;
};

export function RecentFiltersBar({ search, paidByOptions, activeCount }: Props) {
  const navigate = useNavigate();
  const [storeDraft, setStoreDraft] = useState(search.q ?? '');
  const debouncedStore = useDebounce(storeDraft, 300);
  // Tracks the value we last pushed to the URL ourselves so the sync-effect
  // below can ignore our own round-trip and only react to *external* URL
  // changes (clear-all button, browser back/forward, manual URL edit).
  const ownPushRef = useRef<string | undefined>(search.q);

  useEffect(() => {
    if (ownPushRef.current === search.q) return;
    ownPushRef.current = search.q;
    setStoreDraft(search.q ?? '');
  }, [search.q]);

  useEffect(() => {
    const normalized = debouncedStore || undefined;
    if (normalized === (search.q ?? undefined)) return;
    ownPushRef.current = normalized;
    void navigate({
      to: '/recent',
      search: { ...search, q: normalized, saved: undefined },
    });
    // Omit search/navigate from deps: search is a fresh object every render
    // (would defeat the debounce), navigate is stable enough in practice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedStore]);

  const update = (patch: Partial<RecentSearchInput>) => {
    void navigate({
      to: '/recent',
      search: { ...search, ...patch, saved: undefined },
    });
  };

  const clearAll = () => void navigate({ to: '/recent', search: {} });

  const onNumber = (key: 'min' | 'max') => (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    update({ [key]: v === '' ? undefined : Number(v) });
  };

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
      <div className="grid grid-cols-12 gap-2">
        <div className="col-span-12 sm:col-span-4">
          <label className={FIELD_LABEL_CLASS} htmlFor="filter-store">
            Магазин
          </label>
          <Input
            id="filter-store"
            placeholder="Lidl, Aldi…"
            value={storeDraft}
            onChange={(e) => setStoreDraft(e.target.value)}
          />
        </div>
        <div className="col-span-6 sm:col-span-2">
          <label className={FIELD_LABEL_CLASS} htmlFor="filter-from">
            З дати
          </label>
          <Input
            id="filter-from"
            type="date"
            value={search.from ?? ''}
            onChange={(e) => update({ from: e.target.value || undefined })}
          />
        </div>
        <div className="col-span-6 sm:col-span-2">
          <label className={FIELD_LABEL_CLASS} htmlFor="filter-to">
            По дату
          </label>
          <Input
            id="filter-to"
            type="date"
            value={search.to ?? ''}
            onChange={(e) => update({ to: e.target.value || undefined })}
          />
        </div>
        <div className="col-span-12 sm:col-span-2">
          <label className={FIELD_LABEL_CLASS} htmlFor="filter-paid-by">
            Оплатив
          </label>
          <select
            id="filter-paid-by"
            className={SELECT_CLASS}
            value={search.paid_by ?? ''}
            onChange={(e) => update({ paid_by: e.target.value || undefined })}
          >
            <option value="">Будь-хто</option>
            {paidByOptions.map((email) => (
              <option key={email} value={email}>
                {email}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-6 sm:col-span-1">
          <label className={FIELD_LABEL_CLASS} htmlFor="filter-min">
            Мін €
          </label>
          <Input
            id="filter-min"
            type="number"
            step="0.01"
            min="0"
            value={search.min ?? ''}
            onChange={onNumber('min')}
          />
        </div>
        <div className="col-span-6 sm:col-span-1">
          <label className={FIELD_LABEL_CLASS} htmlFor="filter-max">
            Макс €
          </label>
          <Input
            id="filter-max"
            type="number"
            step="0.01"
            min="0"
            value={search.max ?? ''}
            onChange={onNumber('max')}
          />
        </div>
      </div>
      {activeCount > 0 && (
        <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
          <span>
            Активні фільтри: <span className="font-medium">{activeCount}</span>
          </span>
          <button type="button" onClick={clearAll} className="underline hover:no-underline">
            Очистити все
          </button>
        </div>
      )}
    </div>
  );
}
