import { StoreLogo } from '@/shared/ui/StoreLogo';
import { Button } from '@/shared/ui/Button';
import { formatDate } from '@/shared/utils/format-date';
import { formatMoney } from '@/shared/utils/format-money';
import type { PackagedProductStoreLabelRow } from '../types';

type Props = Readonly<{
  labels: PackagedProductStoreLabelRow[];
  onUnlink?: (row: PackagedProductStoreLabelRow) => void;
  unlinking?: boolean;
}>;

/**
 * The point of the whole catalogue: six months later a receipt line reading
 * "Original" is still identifiable, because this table records that REWE prints
 * it that way for this exact product.
 */
export function StoreLabelsTable({ labels, onUnlink, unlinking = false }: Props) {
  if (labels.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Ще жодна позиція з чеків не привʼязана до цієї картки.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-slate-100">
      {labels.map((row) => (
        <li key={row.product_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
          <StoreLogo store={row.store} className="h-6 w-6 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-900">{row.store}</p>
            <p className="truncate text-sm text-slate-600">
              У чеку:{' '}
              {row.receipt_labels.length > 0 ? (
                <span className="font-mono text-xs text-slate-800">
                  {row.receipt_labels.join(' · ')}
                </span>
              ) : (
                <span className="font-mono text-xs text-slate-800">{row.product_name}</span>
              )}
              {row.store_product_code ? (
                <span className="ml-2 text-xs text-slate-500">код {row.store_product_code}</span>
              ) : null}
            </p>
          </div>
          <div className="text-right text-xs text-slate-600">
            <p>
              {row.purchases_count > 0 ? `${String(row.purchases_count)} покупок` : 'ще не куплено'}
            </p>
            {row.last_price_orig != null ? (
              <p className="tabular-nums">
                {formatMoney(row.last_price_orig, row.last_currency ?? 'EUR')}
                {row.last_purchased_on ? ` · ${formatDate(row.last_purchased_on)}` : ''}
              </p>
            ) : null}
          </div>
          {onUnlink ? (
            <Button
              type="button"
              variant="ghost"
              className="px-2 text-xs"
              disabled={unlinking}
              onClick={() => onUnlink(row)}
            >
              Відвʼязати
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
