import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { PurchaseCorrectionDialog } from '@/features/product-corrections';
import { formatDate } from '@/shared/utils/format-date';
import { formatMoney } from '@/shared/utils/format-money';
import type { StatsDetailItem } from '../category-details';

const PAGE_SIZE = 50;

export function StatsPurchaseList({ items }: Readonly<{ items: StatsDetailItem[] }>) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold">Історія покупок</h3>
      <p className="mt-1 text-xs text-slate-500">
        Від найновіших. Виправлення назви та категорії доступне для кожної позиції.
      </p>
      <ul className="mt-3 divide-y divide-slate-100">
        {items.slice(0, visible).map((item) => (
          <li key={item.id} className="py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-slate-900">{item.product_name}</p>
                <p className="text-sm text-slate-600">
                  {item.receipt.store} · {formatDate(item.receipt.date)} ·{' '}
                  {item.receipt.time?.slice(0, 5) ?? 'Час не вказано'}
                </p>
                <p className="text-xs text-slate-500">
                  {item.category}
                  {item.variant ? ` · ${item.variant.name_uk}` : ''}
                </p>
                {item.qty !== undefined && item.unit_price_orig !== undefined ? (
                  <p className="text-xs text-slate-500">
                    {item.qty} ×{' '}
                    {formatMoney(
                      item.unit_price_orig - (item.discount_orig ?? 0),
                      item.receipt.currency ?? 'EUR',
                    )}{' '}
                    за одиницю
                    {(item.discount_orig ?? 0) > 0 ? ' (зі знижкою)' : ''}
                  </p>
                ) : null}
              </div>
              <div className="text-right text-sm tabular-nums">
                <p className="font-semibold">{formatMoney(item.total_eur, 'EUR')}</p>
                {item.receipt.currency &&
                item.receipt.currency !== 'EUR' &&
                item.total_orig !== undefined ? (
                  <p className="text-xs text-slate-500">
                    {formatMoney(item.total_orig, item.receipt.currency)}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-sm">
              <button
                type="button"
                className="text-teal-700 underline"
                onClick={() => setEditing(item.id)}
              >
                Виправити товар
              </button>
              <Link
                to="/edit/$id"
                params={{ id: item.receipt_id }}
                className="text-teal-700 underline"
              >
                {item.receipt.photo_path || item.receipt.photo_url
                  ? 'Чек і фото оригіналу'
                  : 'Відкрити чек'}
              </Link>
            </div>
          </li>
        ))}
      </ul>
      {visible < items.length ? (
        <button
          type="button"
          className="mt-3 text-sm text-teal-700 underline"
          onClick={() => setVisible((value) => value + PAGE_SIZE)}
        >
          Показати ще ({items.length - visible})
        </button>
      ) : null}
      {editing ? (
        <PurchaseCorrectionDialog itemId={editing} onClose={() => setEditing(null)} />
      ) : null}
    </section>
  );
}
