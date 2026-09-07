import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/shared/ui/Button';
import type { StatsFilterOptions, StatsFilters } from '../api/stats.types';
import { loadStatsFilters, saveStatsPreferences } from '../stats-preferences';

type Selection = {
  categories: string[];
  stores: string[];
};

type Props = {
  options: StatsFilterOptions;
  isLoading: boolean;
  onChange: (filters: StatsFilters) => void;
};

function sameValues(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function FilterDropdown({
  label,
  values,
  selected,
  onSelectAll,
  onClearAll,
  onToggle,
}: {
  label: string;
  values: string[];
  selected: string[];
  onSelectAll: () => void;
  onClearAll: () => void;
  onToggle: (value: string) => void;
}) {
  const selectedCount = selected.length;

  return (
    <details className="relative min-w-52">
      <summary className="flex h-10 cursor-pointer list-none items-center justify-between gap-3 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <span>{label}</span>
        <span className="text-xs text-slate-500">
          {selectedCount} з {values.length}
        </span>
      </summary>
      <div className="absolute left-0 z-10 mt-2 w-full min-w-72 rounded-md border border-slate-200 bg-white p-3 shadow-lg">
        <div className="mb-2 flex gap-2 border-b border-slate-100 pb-3">
          <Button variant="secondary" className="h-8 flex-1 px-2 text-xs" onClick={onSelectAll}>
            Вибрати всі
          </Button>
          <Button variant="secondary" className="h-8 flex-1 px-2 text-xs" onClick={onClearAll}>
            Зняти всі
          </Button>
        </div>
        <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
          {values.map((value) => (
            <label
              key={value}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={selected.includes(value)}
                onChange={() => onToggle(value)}
                className="size-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              />
              <span className="truncate">{value}</span>
            </label>
          ))}
        </div>
      </div>
    </details>
  );
}

export function StatsFiltersPicker({ options, isLoading, onChange }: Props) {
  const [storedSelection, setStoredSelection] = useState<StatsFilters>(loadStatsFilters);

  const selection = useMemo<Selection>(
    () => ({
      categories:
        storedSelection.categories?.filter((value) => options.categories.includes(value)) ??
        options.categories,
      stores:
        storedSelection.stores?.filter((value) => options.stores.includes(value)) ?? options.stores,
    }),
    [options, storedSelection],
  );

  useEffect(() => {
    onChange(storedSelection);
  }, [storedSelection, onChange]);

  const updateValues = (key: keyof Selection, values: string[] | undefined) => {
    const next = { ...storedSelection };
    if (values === undefined || (values.length > 0 && sameValues(values, options[key]))) {
      delete next[key];
    } else {
      next[key] = values;
    }
    setStoredSelection(next);
    saveStatsPreferences({ [key]: next[key] });
  };

  const toggle = (key: keyof Selection, value: string) => {
    const values = selection[key];
    updateValues(
      key,
      values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value],
    );
  };

  return (
    <section
      className="rounded-md border border-slate-200 bg-white p-4"
      aria-label="Фільтри статистики"
    >
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-slate-900">Враховувати в статистиці</h2>
        <p className="text-xs text-slate-500">
          Зніміть позначки з категорій або магазинів, які не треба враховувати.
        </p>
      </div>
      {isLoading ? (
        <p className="text-sm text-slate-500">Завантажую фільтри...</p>
      ) : (
        <div className="flex flex-wrap gap-3">
          <FilterDropdown
            label="Категорії"
            values={options.categories}
            selected={selection.categories}
            onSelectAll={() => updateValues('categories', undefined)}
            onClearAll={() => updateValues('categories', [])}
            onToggle={(value) => toggle('categories', value)}
          />
          <FilterDropdown
            label="Магазини"
            values={options.stores}
            selected={selection.stores}
            onSelectAll={() => updateValues('stores', undefined)}
            onClearAll={() => updateValues('stores', [])}
            onToggle={(value) => toggle('stores', value)}
          />
        </div>
      )}
    </section>
  );
}
