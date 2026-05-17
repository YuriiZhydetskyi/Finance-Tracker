import { Link } from '@tanstack/react-router';
import { formatDate } from '@/shared/utils/format-date';
import { formatMoney } from '@/shared/utils/format-money';
import type { DuplicateCandidate } from '../api/use-duplicate-receipts';

type Props = {
  candidates: DuplicateCandidate[];
  onDismiss: () => void;
};

export function DuplicateWarningBanner({ candidates, onDismiss }: Props) {
  if (candidates.length === 0) return null;
  const isSingle = candidates.length === 1;
  return (
    <div
      role="alert"
      className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
    >
      <div className="font-medium">
        Знайдено {isSingle ? 'подібний чек' : `${String(candidates.length)} подібні чеки`} —
        можливо, це дублікат.
      </div>
      <ul className="mt-1 space-y-1 text-xs">
        {candidates.map((c) => (
          <li key={c.id}>
            <Link to="/edit/$id" params={{ id: c.id }} className="underline hover:no-underline">
              {c.store}, {formatDate(c.date)}
              {c.time ? ` · ${c.time.slice(0, 5)}` : ''}, {formatMoney(c.total_orig, c.currency)}
            </Link>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-1 text-xs underline hover:no-underline"
      >
        Це новий чек
      </button>
    </div>
  );
}
