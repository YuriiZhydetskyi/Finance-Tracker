import { useQuery } from '@tanstack/react-query';
import { photoStorage } from '@/shared/lib/dependencies';
import { formatDate } from '@/shared/utils/format-date';
import { Button } from '@/shared/ui/Button';
import type { PendingParseRow } from '../api/use-pending-parses';

type Props = {
  rows: PendingParseRow[];
  onReparseAll: () => void;
  onReparseOne: (row: PendingParseRow) => void;
  onDiscard: (row: PendingParseRow) => void;
  /** True while blobs are being downloaded + the batch hydrated. */
  isPreparing: boolean;
  discardingId: string | null;
};

function isPdf(path: string): boolean {
  return /\.pdf$/i.test(path);
}

function PendingThumbnail({ path }: { path: string }) {
  const { data: signedUrl } = useQuery({
    queryKey: ['pending-parse-thumb', path] as const,
    queryFn: () => photoStorage.getSignedUrl(path),
    // Signed URLs live 1h; refresh a bit earlier so the <img> never 403s.
    staleTime: 50 * 60_000,
    enabled: !isPdf(path),
  });

  if (isPdf(path)) {
    return (
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50">
        <span className="font-mono text-xs uppercase text-slate-500">PDF</span>
      </div>
    );
  }

  if (!signedUrl) {
    return <div className="h-16 w-16 shrink-0 animate-pulse rounded-md bg-slate-200" />;
  }

  return (
    <img
      src={signedUrl}
      alt="Чек із черги"
      className="h-16 w-16 shrink-0 rounded-md border border-slate-200 object-cover"
    />
  );
}

export function PendingList({
  rows,
  onReparseAll,
  onReparseOne,
  onDiscard,
  isPreparing,
  discardingId,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          {rows.length} {rows.length === 1 ? 'чек чекає' : 'чеків чекають'} повторного
          розпізнавання. Хто оплатив — уже збережено, тож вводити знову не доведеться.
        </p>
        <Button type="button" onClick={onReparseAll} disabled={isPreparing}>
          {isPreparing ? 'Готую...' : 'Розпарсити всі'}
        </Button>
      </div>

      <ul className="space-y-2">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex items-start gap-3 rounded-md border border-slate-200 bg-white p-3"
          >
            <PendingThumbnail path={row.photo_path} />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
                <span className="font-medium text-slate-900">{row.original_filename ?? 'Чек'}</span>
                <span className="text-slate-500">{formatDate(row.created_at.slice(0, 10))}</span>
                <span className="text-slate-500">Оплатив: {row.paid_by}</span>
                {row.attempts > 0 && <span className="text-slate-400">спроб: {row.attempts}</span>}
              </div>
              {row.error_message && (
                <p className="line-clamp-2 text-xs text-red-700">{row.error_message}</p>
              )}
            </div>
            <div className="flex shrink-0 flex-col gap-1.5">
              <Button
                type="button"
                variant="secondary"
                className="h-8 px-3 text-xs"
                onClick={() => onReparseOne(row)}
                disabled={isPreparing}
              >
                Розпарсити
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-8 px-3 text-xs"
                onClick={() => onDiscard(row)}
                disabled={discardingId === row.id}
              >
                {discardingId === row.id ? 'Видаляю...' : 'Відкинути'}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
