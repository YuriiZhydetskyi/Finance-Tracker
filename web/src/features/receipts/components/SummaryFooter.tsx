import { useFormContext, useWatch } from 'react-hook-form';
import type { ManualFormValues } from '../schemas/manual-form';
import { computeCategoryBreakdown, computeGrandTotal } from '../utils/totals';
import { formatMoney } from '@/shared/utils/format-money';
import { cn } from '@/shared/ui/cn';

export function SummaryFooter() {
  const { control } = useFormContext<ManualFormValues>();
  const currency = useWatch({ control, name: 'currency' });
  const { grand, breakdown } = useWatch({
    control,
    name: 'items',
    compute: (items) => ({
      grand: computeGrandTotal(items ?? []),
      breakdown: computeCategoryBreakdown(items ?? []),
    }),
  });

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-600">Загалом</span>
        <span className={cn('text-2xl font-semibold tabular-nums', grand < 0 && 'text-red-600')}>
          {formatMoney(grand, currency)}
        </span>
      </div>

      {breakdown.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm">
          {breakdown.map((row) => (
            <li
              key={row.category}
              className={cn(
                'flex items-center justify-between text-slate-700',
                row.total < 0 && 'text-red-600',
              )}
            >
              <span>{row.category}</span>
              <span className="tabular-nums">{formatMoney(row.total, currency)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
