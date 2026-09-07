import { formatMoney } from '@/shared/utils/format-money';
import type { StatsBreakdownRow } from '../category-details';

type Props = Readonly<{
  rows: StatsBreakdownRow[];
  total: number;
  label: string;
  onSelect?: (key: string) => void;
}>;

const percent = new Intl.NumberFormat('uk-UA', { style: 'percent', maximumFractionDigits: 1 });

export function StatsBreakdown({ rows, total, label, onSelect }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label={label}>
        <thead className="text-left text-xs text-slate-500">
          <tr>
            <th className="py-2 pr-3 font-medium">{label}</th>
            <th className="px-2 py-2 text-right font-medium">Сума</th>
            <th className="py-2 pl-2 text-right font-medium">Частка</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="py-2 pr-3">
                {onSelect ? (
                  <button
                    type="button"
                    className="rounded text-left font-medium text-teal-700 underline decoration-teal-200 underline-offset-4 hover:text-teal-900 focus-visible:outline-2 focus-visible:outline-teal-600"
                    onClick={() => onSelect(row.key)}
                  >
                    {row.name || 'Без назви'} →
                  </button>
                ) : (
                  row.name || 'Без назви'
                )}
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                {formatMoney(row.total_eur, 'EUR')}
              </td>
              <td className="whitespace-nowrap py-2 pl-2 text-right tabular-nums text-slate-600">
                {total > 0 ? percent.format(row.total_eur / total) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
