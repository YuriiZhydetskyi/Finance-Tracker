import type { Receipt, StatementTransaction } from '@finance-tracker/domain';
import { Button } from '@/shared/ui/Button';
import { formatMoney } from '@/shared/utils/format-money';
import { formatDate } from '@/shared/utils/format-date';
import { useSelectionOverrides } from '../hooks/use-selection-overrides';

export type OrphanMatch = { receipt: Receipt; needsFlip: boolean; storeMatch: boolean };
export type OrphanSelection = { orphan: StatementTransaction; match: OrphanMatch };

type Props = {
  orphans: StatementTransaction[];
  // Orphans for which a receipt now matches (date+amount) — keyed by orphan id.
  matches: Map<string, OrphanMatch>;
  onCreate: (orphan: StatementTransaction) => void;
  onDismiss: (id: string) => void;
  onLinkSelected: (selections: OrphanSelection[]) => void;
  busy: boolean;
};

function orphanLine(o: StatementTransaction): string {
  const amount = formatMoney(o.amount_orig, o.currency);
  const label = o.merchant ?? o.raw;
  return `${amount} · ${formatDate(o.date)}${label ? ` · ${label}` : ''}`;
}

export function OrphanList({ orphans, matches, onCreate, onDismiss, onLinkSelected, busy }: Props) {
  // Matches load asynchronously (re-match waits on a receipts query) and the
  // list shrinks as orphans resolve, so defaults must stay live — keyed by
  // orphan id, NOT the re-match txn index, which shifts with the list.
  const selection = useSelectionOverrides<string>();

  if (orphans.length === 0) return null;

  const matched: OrphanSelection[] = [];
  const unmatched: StatementTransaction[] = [];
  for (const orphan of orphans) {
    const match = matches.get(orphan.id);
    if (match) matched.push({ orphan, match });
    else unmatched.push(orphan);
  }

  const isChecked = (s: OrphanSelection) => selection.isSelected(s.orphan.id, s.match.storeMatch);
  const selected = matched.filter(isChecked);
  const allSelected = selected.length === matched.length && matched.length > 0;

  return (
    <section className="space-y-3">
      <div className="space-y-0.5">
        <h2 className="text-lg font-semibold text-slate-900">Без чека ({orphans.length})</h2>
        <p className="text-sm text-slate-600">
          Витрати з картки, для яких немає збереженого чека. Створи чек (хоча б суму/місце/дату) або
          приховай, якщо це не витрата, яку відстежуємо.
        </p>
      </div>

      {matched.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="space-y-0.5">
              <h3 className="text-sm font-semibold text-slate-700">
                Знайдено чек ({matched.length})
              </h3>
              <p className="text-xs text-slate-500">
                Чек з’явився вже після імпорту виписки. Перевір позначені та зв’яжи разом.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                selection.setAll(
                  matched.map((s) => s.orphan.id),
                  !allSelected,
                )
              }
              className="text-sm font-medium text-slate-600 underline-offset-2 hover:underline"
            >
              {allSelected ? 'Зняти всі' : 'Вибрати всі'}
            </button>
          </div>
          <ul className="space-y-2">
            {matched.map((s) => (
              <li
                key={s.orphan.id}
                className="flex items-start gap-3 rounded-md border border-slate-200 bg-white p-3"
              >
                <input
                  type="checkbox"
                  checked={isChecked(s)}
                  onChange={() => selection.toggle(s.orphan.id, s.match.storeMatch)}
                  aria-label={`Зв'язати: ${s.match.receipt.store}`}
                  className="mt-1 h-4 w-4 shrink-0"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="text-sm text-slate-800">{orphanLine(s.orphan)}</div>
                  <div className="text-xs text-slate-500">картка: {s.orphan.paid_by}</div>
                  <div className="text-xs text-emerald-700">
                    Знайдено чек: {s.match.receipt.store} · {formatDate(s.match.receipt.date)}
                    {s.match.needsFlip
                      ? ` · платник ${s.match.receipt.paid_by} → ${s.orphan.paid_by}`
                      : ''}
                  </div>
                  {!s.match.storeMatch && (
                    <div className="text-xs text-amber-800">
                      у чеку: <span className="font-medium">{s.match.receipt.store}</span>
                      <span className="px-1 text-amber-400">·</span>у виписці:{' '}
                      <span className="font-medium">
                        {s.orphan.merchant ?? s.orphan.raw ?? '—'}
                      </span>
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onDismiss(s.orphan.id)}
                  disabled={busy}
                >
                  Ігнорувати
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => onLinkSelected(selected)}
              disabled={selected.length === 0 || busy}
            >
              {busy ? 'Зв’язую…' : `Зв’язати вибрані (${selected.length})`}
            </Button>
          </div>
        </div>
      )}

      {unmatched.length > 0 && (
        <ul className="space-y-2">
          {unmatched.map((o) => (
            <li
              key={o.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-slate-200 bg-white p-3"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="text-sm text-slate-800">{orphanLine(o)}</div>
                <div className="text-xs text-slate-500">картка: {o.paid_by}</div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => onCreate(o)}
                  disabled={busy}
                >
                  Створити чек
                </Button>
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
          ))}
        </ul>
      )}
    </section>
  );
}
