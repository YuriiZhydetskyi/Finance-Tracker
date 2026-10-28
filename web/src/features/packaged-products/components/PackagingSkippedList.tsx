import { useState } from 'react';
import { StoreLogo } from '@/shared/ui/StoreLogo';
import { Button } from '@/shared/ui/Button';
import type { SkippedPackagingProductRow } from '../types';
import { countBySkipReason, skipReasonLabel } from '../utils/packaging-skip-reasons';

type Props = Readonly<{
  rows: SkippedPackagingProductRow[];
  onRestore: (productIds: string[]) => void;
  busy?: boolean;
  emptyMessage?: string;
}>;

/**
 * Rows marked «Без упаковки», each with the way back into the queue. Rows flagged
 * by the bulk rule carry its name; «Повернути всі, позначені правилом» undoes the
 * rule in one go and never touches rows the owner flagged by hand.
 */
export function PackagingSkippedList({
  rows,
  onRestore,
  busy = false,
  emptyMessage = 'Позицій без упаковки немає.',
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const byRule = rows.filter((row) => row.packaging_not_applicable_reason !== null);

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
        <p>
          Ці позиції ніколи не потраплять у чергу «Без картки». Помилково позначену можна повернути
          назад.
        </p>
        <p className="flex flex-wrap gap-x-3 gap-y-1">
          {countBySkipReason(rows).map((entry) => (
            <span key={entry.reason ?? 'manual'}>
              {entry.label}: <strong className="font-semibold">{entry.count}</strong>
            </span>
          ))}
        </p>
        {byRule.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {confirming ? (
              <>
                <Button
                  type="button"
                  variant="danger"
                  className="h-7 px-3 text-xs"
                  disabled={busy}
                  onClick={() => {
                    onRestore(byRule.map((row) => row.id));
                    setConfirming(false);
                  }}
                >
                  Так, повернути {byRule.length} у чергу
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-7 px-3 text-xs"
                  onClick={() => setConfirming(false)}
                >
                  Скасувати
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="secondary"
                className="h-7 px-3 text-xs"
                disabled={busy}
                onClick={() => setConfirming(true)}
              >
                Повернути в чергу всі, позначені правилом ({byRule.length})
              </Button>
            )}
          </div>
        ) : null}
      </div>

      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="rounded-md border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <StoreLogo store={row.store} className="h-6 w-6 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">
                  {row.brand ? `${row.brand} · ` : ''}
                  {row.name}
                </p>
                <p className="truncate text-xs text-slate-600">
                  {row.store} · {row.category}
                  {row.store_product_code ? ` · код ${row.store_product_code}` : ''}
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                {skipReasonLabel(row.packaging_not_applicable_reason)}
              </span>
              <Button
                type="button"
                variant="secondary"
                className="px-3"
                disabled={busy}
                onClick={() => onRestore([row.id])}
              >
                Повернути в чергу
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
