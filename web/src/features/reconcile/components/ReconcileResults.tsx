import { useState, type ReactNode } from 'react';
import type {
  AmbiguousEntry,
  Confidence,
  ReconcileResult,
  ToFixEntry,
  UnmatchedEntry,
} from '@finance-tracker/domain';
import { Button } from '@/shared/ui/Button';
import { formatMoney } from '@/shared/utils/format-money';
import { formatDate } from '@/shared/utils/format-date';

type Props = {
  result: ReconcileResult;
  onApply: (entries: ToFixEntry[]) => void;
  isApplying: boolean;
};

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: 'точний збіг',
  medium: 'збіг ±1 день',
  low: 'збіг у межах вікна',
};

const CONFIDENCE_CLASS: Record<Confidence, string> = {
  high: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  medium: 'border-amber-300 bg-amber-50 text-amber-800',
  low: 'border-slate-300 bg-slate-50 text-slate-700',
};

const UNMATCHED_REASON: Record<UnmatchedEntry['reason'], string> = {
  'no-candidate': 'немає чека на цю суму/дату',
  'receipt-taken': 'чек уже зіставлено з іншою транзакцією',
  refund: 'повернення коштів — не звіряємо',
};

function txnLine(txn: ToFixEntry['txn']): string {
  const amount = formatMoney(txn.amount, txn.currency);
  const merchant = txn.merchant ? ` · ${txn.merchant}` : '';
  return `${amount} · ${formatDate(txn.date)}${merchant}`;
}

export function ReconcileResults({ result, onApply, isApplying }: Props) {
  const { toFix, alreadyCorrect, ambiguous, unmatchedStatementLines } = result;

  // A store-name match is confident enough to pre-select; a date+amount-only
  // match (store differs) is left for the user to confirm. Track de-selections
  // (keyed by txn index) seeded with the store-mismatch lines, so those start
  // unchecked while store matches start checked. Initializer-only state — the
  // page remounts this component per import (key=runId), so stale indices from a
  // prior statement can't leak in.
  const [deselected, setDeselected] = useState<Set<number>>(
    () => new Set(toFix.filter((e) => !e.storeMatch).map((e) => e.txn.index)),
  );
  const selected = toFix.filter((e) => !deselected.has(e.txn.index));

  const toggle = (index: number) =>
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const allSelected = selected.length === toFix.length && toFix.length > 0;
  const toggleAll = () =>
    setDeselected(allSelected ? new Set(toFix.map((e) => e.txn.index)) : new Set());

  const storeMatches = toFix.filter((e) => e.storeMatch);
  const storeMismatches = toFix.filter((e) => !e.storeMatch);

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">
            Запропоновані виправлення {toFix.length > 0 && `(${toFix.length})`}
          </h2>
          {toFix.length > 0 && (
            <button
              type="button"
              onClick={toggleAll}
              className="text-sm font-medium text-slate-600 underline-offset-2 hover:underline"
            >
              {allSelected ? 'Зняти всі' : 'Прийняти всі'}
            </button>
          )}
        </div>

        {toFix.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
            Немає чеків, у яких треба змінити платника.
          </p>
        ) : (
          <>
            {storeMatches.length > 0 && (
              <FixGroup
                title={`Магазин збігся (${storeMatches.length})`}
                hint="Назва магазину збіглася — впевнений збіг, перевір і застосуй."
                entries={storeMatches}
                deselected={deselected}
                onToggle={toggle}
              />
            )}

            {storeMismatches.length > 0 && (
              <FixGroup
                title={`Магазин інший — підтвердь (${storeMismatches.length})`}
                hint="Дата й сума збіглися, але назва магазину інша. Познач, якщо це той самий чек."
                entries={storeMismatches}
                deselected={deselected}
                onToggle={toggle}
              />
            )}

            <div className="flex justify-end">
              <Button
                type="button"
                onClick={() => onApply(selected)}
                disabled={selected.length === 0 || isApplying}
              >
                {isApplying ? 'Застосовую…' : `Застосувати (${selected.length})`}
              </Button>
            </div>
          </>
        )}
      </section>

      {ambiguous.length > 0 && <AmbiguousSection entries={ambiguous} />}

      {unmatchedStatementLines.length > 0 && (
        <InfoSection title={`Без збігу (${unmatchedStatementLines.length})`}>
          <ul className="space-y-1 text-sm text-slate-600">
            {unmatchedStatementLines.map((u) => (
              <li key={u.txn.index} className="flex flex-wrap justify-between gap-2">
                <span>{txnLine(u.txn)}</span>
                <span className="text-slate-400">{UNMATCHED_REASON[u.reason]}</span>
              </li>
            ))}
          </ul>
        </InfoSection>
      )}

      {alreadyCorrect.length > 0 && (
        <InfoSection title={`Вже правильні (${alreadyCorrect.length})`}>
          <p className="text-sm text-slate-600">
            Ці чеки вже віднесені на власника картки — нічого міняти.
          </p>
        </InfoSection>
      )}
    </div>
  );
}

function FixGroup({
  title,
  hint,
  entries,
  deselected,
  onToggle,
}: {
  title: string;
  hint: string;
  entries: ToFixEntry[];
  deselected: Set<number>;
  onToggle: (index: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="space-y-0.5">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        <p className="text-xs text-slate-500">{hint}</p>
      </div>
      <ul className="space-y-2">
        {entries.map((entry) => (
          <li
            key={entry.txn.index}
            className="flex items-start gap-3 rounded-md border border-slate-200 bg-white p-3"
          >
            <input
              type="checkbox"
              checked={!deselected.has(entry.txn.index)}
              onChange={() => onToggle(entry.txn.index)}
              aria-label={`Виправити: ${entry.receipt.store}`}
              className="mt-1 h-4 w-4 shrink-0"
            />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-900">{entry.receipt.store}</span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs ${CONFIDENCE_CLASS[entry.confidence]}`}
                >
                  {CONFIDENCE_LABEL[entry.confidence]}
                </span>
              </div>
              <div className="text-sm text-slate-600">{txnLine(entry.txn)}</div>
              <div className="text-sm">
                <span className="text-red-700 line-through">{entry.from}</span>
                <span className="px-1 text-slate-400">→</span>
                <span className="font-medium text-emerald-700">{entry.to}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AmbiguousSection({ entries }: { entries: AmbiguousEntry[] }) {
  return (
    <InfoSection title={`Неоднозначні (${entries.length})`}>
      <p className="mb-2 text-sm text-slate-600">
        Кілька чеків підходять однаково добре — виправ платника вручну на сторінці чека.
      </p>
      <ul className="space-y-2">
        {entries.map((e) => (
          <li key={e.txn.index} className="rounded-md border border-slate-200 bg-white p-2 text-sm">
            <div className="font-medium text-slate-800">{txnLine(e.txn)}</div>
            <ul className="mt-1 space-y-0.5 text-slate-600">
              {e.candidates.map((c) => (
                <li key={c.receipt.id}>
                  {c.receipt.store} · {formatDate(c.receipt.date)} · {c.receipt.paid_by}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </InfoSection>
  );
}

function InfoSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-slate-200 bg-slate-50/60 p-3">
      <h3 className="mb-1 text-sm font-semibold text-slate-700">{title}</h3>
      {children}
    </section>
  );
}
