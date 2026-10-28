import { Button } from '@/shared/ui/Button';
import {
  PACKAGING_QUEUE_WINDOW_DAYS,
  type PackagingQueueScope,
} from '../utils/packaging-queue-window';

type Props = Readonly<{
  scope: PackagingQueueScope;
  /** Rows currently listed. */
  shown: number;
  /** Rows that match, wherever their last purchase falls; null until the summary arrives. */
  total: number | null;
  /** Matching rows inside the recency window; null until the summary arrives. */
  recent: number | null;
  /** The list hit its row limit, so `shown` is less than `total`. */
  truncated: boolean;
  onShowAll: () => void;
  onShowRecent: () => void;
}>;

/**
 * Says what the queue is currently limited to and how much that hides, with the
 * way to change it. The default view hides old, rarely bought rows; a search never
 * does, so a typed name always finds its row.
 */
export function PackagingQueueScopeBar({
  scope,
  shown,
  total,
  recent,
  truncated,
  onShowAll,
  onShowRecent,
}: Props) {
  const hidden = total != null && recent != null ? Math.max(total - recent, 0) : null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
    >
      <p>
        {scope === 'search' ? (
          <>
            Знайдено {total ?? shown} за запитом. Пошук іде по всіх позиціях, а не лише за останні{' '}
            {PACKAGING_QUEUE_WINDOW_DAYS} днів.
          </>
        ) : scope === 'all' ? (
          <>Показано всі позиції без картки: {total ?? shown}. Найновіші — зверху.</>
        ) : (
          <>
            Показано позиції, куплені за останні {PACKAGING_QUEUE_WINDOW_DAYS} днів: {shown}.
            {hidden != null && hidden > 0 ? (
              <>
                {' '}
                <strong className="font-semibold">Приховано давніших: {hidden}.</strong>
              </>
            ) : null}
          </>
        )}
        {truncated ? ' Показано лише першу частину списку — уточни пошук.' : ''}
      </p>
      {scope === 'recent' && hidden != null && hidden > 0 ? (
        <Button type="button" variant="secondary" className="h-7 px-3 text-xs" onClick={onShowAll}>
          Показати всі
        </Button>
      ) : null}
      {scope === 'all' ? (
        <Button
          type="button"
          variant="secondary"
          className="h-7 px-3 text-xs"
          onClick={onShowRecent}
        >
          Лише останні {PACKAGING_QUEUE_WINDOW_DAYS} днів
        </Button>
      ) : null}
    </div>
  );
}
