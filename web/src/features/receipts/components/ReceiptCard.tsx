import { Link } from '@tanstack/react-router';
import type { Receipt } from '@finance-tracker/domain';
import { formatDate } from '@/shared/utils/format-date';
import { formatMoney } from '@/shared/utils/format-money';
import { cn } from '@/shared/ui/cn';

type Props = {
  receipt: Receipt;
};

export function ReceiptCard({ receipt }: Props) {
  const isNonEur = receipt.currency !== 'EUR';
  return (
    <Link
      to="/edit/$id"
      params={{ id: receipt.id }}
      className="block rounded-md border border-slate-200 bg-white p-3 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-semibold text-slate-900">{receipt.store}</span>
        <span
          className={cn(
            'tabular-nums text-sm font-medium',
            receipt.total_eur < 0 ? 'text-red-600' : 'text-slate-900',
          )}
        >
          {formatMoney(receipt.total_eur, 'EUR')}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
        <span>
          {formatDate(receipt.date)}
          {receipt.time ? ` · ${receipt.time.slice(0, 5)}` : ''}
        </span>
        {isNonEur && <span>· {formatMoney(receipt.total_orig, receipt.currency)}</span>}
        {receipt.note && <span className="italic">· {receipt.note}</span>}
      </div>
      {receipt.store_address && (
        <div className="mt-0.5 truncate text-xs text-slate-400">{receipt.store_address}</div>
      )}
    </Link>
  );
}
