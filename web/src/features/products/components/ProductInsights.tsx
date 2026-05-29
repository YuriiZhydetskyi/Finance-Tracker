import { useEffect, useMemo, useState } from 'react';
import { ulid } from '@finance-tracker/domain';
import { supabase } from '@/shared/lib/supabase-client';
import { Button } from '@/shared/ui/Button';
import { Input } from '@/shared/ui/Input';
import { cn } from '@/shared/ui/cn';
import type { ProductRow } from '../api/use-products';
import { useSearchProducts } from '../api/use-search-products';
import { usePriceHistory } from '../api/use-price-history';
import { computePriceTrend } from '../lib/price-trend';
import { useCreateShareLinkMutation } from '../api/use-shared-link';

// Wrap each occurrence of the query in the product name with guillemets so the
// matched part stands out in the suggestion list.
function highlight(text: string, query: string): string {
  if (!query) return text;
  const re = new RegExp(`(${query}+)+`, 'gi');
  return text.replace(re, (match) => `«${match}»`);
}

async function logSearch(query: string): Promise<void> {
  await supabase.from('product_search_log').insert({ id: ulid(), query });
}

export function ProductInsights() {
  const [query, setQuery] = useState('');
  const [store, setStore] = useState('');
  const [suggestions, setSuggestions] = useState<ProductRow[]>([]);
  const [selected, setSelected] = useState<ProductRow | null>(null);
  const [targetPrice, setTargetPrice] = useState('');
  const [shareToken, setShareToken] = useState<string | null>(null);
  const share = useCreateShareLinkMutation();

  const results = useSearchProducts(query, store);
  const history = usePriceHistory(selected?.id ?? '');
  const trend = useMemo(() => computePriceTrend(history.data ?? []), [history.data]);

  useEffect(() => {
    if (query.trim().length === 0) {
      setSuggestions([]);
      return;
    }
    logSearch(query);
    void supabase
      .from('products')
      .select('id, name, store, store_product_code, category')
      .ilike('name', `%${query}%`)
      .ilike('store', store ? `%${store}%` : '%')
      .limit(8)
      .then(({ data }) => setSuggestions(data ?? []));
  }, [query]);

  const target = parseFloat(targetPrice);
  const storeLabel = selected?.store || 'усі магазини';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Аналітика товарів</h1>
        <p className="text-sm text-slate-600">Пошук товарів та історія цін · {storeLabel}.</p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Назва або код товару"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Input
          placeholder="Магазин (необов'язково)"
          value={store}
          onChange={(e) => setStore(e.target.value)}
          className="sm:w-56"
        />
      </div>

      {suggestions.length > 0 && (
        <ul className="overflow-hidden rounded-md border border-slate-200 bg-white text-sm">
          {suggestions.map((s) => (
            <li
              className="cursor-pointer px-3 py-2 hover:bg-slate-50"
              onClick={() => setSelected(s)}
            >
              {highlight(s.name, query)} · {s.store}
            </li>
          ))}
        </ul>
      )}

      {results.isLoading && <p className="text-sm text-slate-500">Завантажую...</p>}
      {results.isError && (
        <p role="alert" className="text-sm text-red-600">
          Не вдалося завантажити: {results.error.message}
        </p>
      )}
      {results.isSuccess && results.data.length > 0 && (
        <ul className="space-y-1">
          {results.data.map((r) => (
            <li
              key={r.id}
              className={cn(
                'rounded-md border px-3 py-2 text-sm',
                selected?.id === r.id ? 'border-slate-900' : 'border-slate-200',
              )}
            >
              <button type="button" className="text-left" onClick={() => setSelected(r)}>
                {r.name} · {r.store}
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <section className="space-y-3 rounded-md border border-slate-200 p-4">
          <h2 className="font-semibold text-slate-900">{selected.name}</h2>
          {history.isSuccess && (
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-slate-500">Перша</dt>
                <dd>{trend.first.toFixed(2)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Остання</dt>
                <dd>{trend.latest.toFixed(2)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Сер. нетто</dt>
                <dd>{trend.averageNet.toFixed(2)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Зміна</dt>
                <dd>{trend.changePct.toFixed(1)}%</dd>
              </div>
            </dl>
          )}
          <div className="flex items-center gap-2">
            <Input
              placeholder="Ціль ціни"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
              className="w-32"
            />
            <span className="text-sm text-slate-600">
              {((trend.latest / target) * 100).toFixed(0)}% від цілі
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                void share
                  .mutateAsync({ productId: selected.id, points: history.data ?? [] })
                  .then(setShareToken);
              }}
            >
              Поділитися
            </Button>
            {shareToken && (
              <code className="rounded bg-slate-100 px-1 text-xs">/share/{shareToken}</code>
            )}
          </div>
          <Button variant="secondary" onClick={() => setSelected(null)}>
            Закрити
          </Button>
        </section>
      )}
    </div>
  );
}
