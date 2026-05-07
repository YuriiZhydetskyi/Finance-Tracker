import type { PairDetectionResult } from '@finance-tracker/domain';
import { formatMoney } from '@/shared/utils/format-money';
import { cn } from '@/shared/ui/cn';

type Cancellation = PairDetectionResult['cancellations'][number];

type Props = {
  cancellation: Cancellation;
  /** Index in the cancellations array — used by the parent's local include set. */
  index: number;
  included: boolean;
  onToggle: (index: number, included: boolean) => void;
  currency: string;
};

/**
 * Visual card for a detected Rabatt-style cancellation pair (ADR-0012).
 *
 * The card itself does not edit anything in the form's items array. The parent
 * tracks `included` per-card in local state and merges included cancellations
 * into `values.items` at submit time. This avoids RHF v7's fragile
 * append/remove id-tracking dance.
 */
export function CancellationCard({ cancellation, index, included, onToggle, currency }: Props) {
  const total = cancellation.qty * cancellation.unit_price_orig;
  const inputId = `cancellation-${String(index)}`;

  return (
    <div
      className={cn(
        'rounded-md border p-3 text-sm transition',
        included
          ? 'border-amber-400 bg-amber-50'
          : 'border-amber-200 bg-amber-50/50 text-slate-600',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className={cn('font-medium', !included && 'line-through')}>
          {cancellation.product_name}
        </div>
        <div className={cn('tabular-nums', !included && 'line-through')}>
          {cancellation.qty} × {formatMoney(cancellation.unit_price_orig, currency)} ={' '}
          {formatMoney(total, currency)}
        </div>
      </div>
      <label
        htmlFor={inputId}
        className="mt-2 flex cursor-pointer select-none items-center gap-2 text-xs text-slate-700"
      >
        <input
          id={inputId}
          type="checkbox"
          checked={included}
          onChange={(e) => {
            onToggle(index, e.target.checked);
          }}
          className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
        />
        Включити до чеку (за замовчуванням позицію скасовано)
      </label>
    </div>
  );
}
