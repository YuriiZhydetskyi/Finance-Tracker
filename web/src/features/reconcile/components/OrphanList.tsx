import type { Receipt, StatementTransaction } from '@finance-tracker/domain';
import { Button } from '@/shared/ui/Button';
import { formatMoney } from '@/shared/utils/format-money';
import { formatDate } from '@/shared/utils/format-date';

export type OrphanMatch = { receipt: Receipt; needsFlip: boolean };

type Props = {
  orphans: StatementTransaction[];
  // Orphans for which a receipt now matches (date+amount) — keyed by orphan id.
  matches: Map<string, OrphanMatch>;
  onCreate: (orphan: StatementTransaction) => void;
  onDismiss: (id: string) => void;
  onLink: (orphan: StatementTransaction, match: OrphanMatch) => void;
  busy: boolean;
};

function orphanLine(o: StatementTransaction): string {
  const amount = formatMoney(o.amount_orig, o.currency);
  const label = o.merchant ?? o.raw;
  return `${amount} · ${formatDate(o.date)}${label ? ` · ${label}` : ''}`;
}

export function OrphanList({ orphans, matches, onCreate, onDismiss, onLink, busy }: Props) {
  if (orphans.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="space-y-0.5">
        <h2 className="text-lg font-semibold text-slate-900">Без чека ({orphans.length})</h2>
        <p className="text-sm text-slate-600">
          Витрати з картки, для яких немає збереженого чека. Створи чек (хоча б суму/місце/дату) або
          приховай, якщо це не витрата, яку відстежуємо.
        </p>
      </div>

      <ul className="space-y-2">
        {orphans.map((o) => {
          const match = matches.get(o.id);
          return (
            <li
              key={o.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-slate-200 bg-white p-3"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="text-sm text-slate-800">{orphanLine(o)}</div>
                <div className="text-xs text-slate-500">картка: {o.paid_by}</div>
                {match && (
                  <div className="text-xs text-emerald-700">
                    Знайдено чек: {match.receipt.store} · {formatDate(match.receipt.date)}
                    {match.needsFlip ? ` · платник ${match.receipt.paid_by} → ${o.paid_by}` : ''}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {match ? (
                  <Button type="button" onClick={() => onLink(o, match)} disabled={busy}>
                    Зв’язати
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => onCreate(o)}
                    disabled={busy}
                  >
                    Створити чек
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onDismiss(o.id)}
                  disabled={busy}
                >
                  Ігнорувати
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
