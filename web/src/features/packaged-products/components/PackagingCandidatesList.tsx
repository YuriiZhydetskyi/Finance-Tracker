import { StoreLogo } from '@/shared/ui/StoreLogo';
import { Button } from '@/shared/ui/Button';
import { formatDate } from '@/shared/utils/format-date';
import { formatMoney } from '@/shared/utils/format-money';
import type { PackagingCandidateRow } from '../types';

type Props = Readonly<{
  candidates: PackagingCandidateRow[];
  onCreateCard: (candidate: PackagingCandidateRow) => void;
  onLinkExisting: (candidate: PackagingCandidateRow) => void;
  onSkip: (candidate: PackagingCandidateRow) => void;
  busyProductId?: string | null;
}>;

/**
 * The work list for photographing. Rows arrive already ranked by how often the
 * physical product was bought and clustered by `group_key`, so the same product
 * bought at two stores sits together — it is one thing to photograph, even though
 * it is two rows to link.
 */
export function PackagingCandidatesList({
  candidates,
  onCreateCard,
  onLinkExisting,
  onSkip,
  busyProductId = null,
}: Props) {
  if (candidates.length === 0) {
    return (
      <p className="rounded-md border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
        Усе сфотографовано. Нових позицій без картки немає.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {candidates.map((candidate, index) => {
        const previous = candidates[index - 1];
        const startsGroup = previous?.group_key !== candidate.group_key;
        const groupSpansStores = candidate.group_purchases_count > candidate.purchases_count;
        const busy = busyProductId === candidate.product_id;

        return (
          <li
            key={candidate.product_id}
            className={`rounded-md border bg-white p-3 ${startsGroup ? 'border-slate-200' : 'border-slate-100 md:ml-6'}`}
          >
            <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
              <StoreLogo store={candidate.store} className="mt-0.5 h-6 w-6 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">
                  {candidate.brand ? `${candidate.brand} · ` : ''}
                  {candidate.product_name}
                </p>
                <p className="truncate text-xs text-slate-600">
                  {candidate.store}
                  {candidate.receipt_labels.length > 0 ? (
                    <>
                      {' · у чеку: '}
                      <span className="font-mono text-slate-800">
                        {candidate.receipt_labels.join(' · ')}
                      </span>
                    </>
                  ) : null}
                  {candidate.store_product_code ? ` · код ${candidate.store_product_code}` : ''}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {candidate.purchases_count} покупок · {candidate.category}
                  {candidate.last_purchased_on
                    ? ` · востаннє ${formatDate(candidate.last_purchased_on)}`
                    : ''}
                  {candidate.last_price_orig != null
                    ? ` · ${formatMoney(candidate.last_price_orig, candidate.last_currency ?? 'EUR')}`
                    : ''}
                </p>
                {startsGroup && groupSpansStores ? (
                  <p className="mt-1 text-xs text-teal-700">
                    Цей товар купувався і в інших магазинах — сфотографуй один раз, потім привʼяжи
                    решту позицій до тієї ж картки.
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => onCreateCard(candidate)}
                  className="px-3"
                >
                  Створити картку
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onLinkExisting(candidate)}
                  className="px-3"
                >
                  Привʼязати
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => onSkip(candidate)}
                  className="px-3"
                  title="Вагові товари, хліб із прилавка, послуги — ніколи не матимуть упаковки"
                >
                  Без упаковки
                </Button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
