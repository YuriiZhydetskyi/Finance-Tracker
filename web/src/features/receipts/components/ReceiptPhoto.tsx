import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { photoStorage } from '@/shared/lib/dependencies';
import { ErrorDetails } from '@/shared/ui/ErrorDetails';

type Props = Readonly<{ photoPath: string | null; photoUrl: string | null }>;

export function ReceiptPhoto({ photoPath, photoUrl }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const query = useQuery({
    queryKey: ['receipt-photo', photoPath, photoUrl],
    enabled: expanded && Boolean(photoPath ?? photoUrl),
    staleTime: 30 * 60_000,
    queryFn: () => (photoPath ? photoStorage.getSignedUrl(photoPath) : Promise.resolve(photoUrl)),
  });
  if (!photoPath && !photoUrl) {
    return <p className="text-sm text-slate-500">Фото оригіналу для цього чека не збережено.</p>;
  }
  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <button
        type="button"
        className="text-sm font-medium text-teal-700 underline"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? 'Сховати фото оригіналу' : 'Показати фото оригіналу чека'}
      </button>
      {expanded ? (
        <div className="mt-3">
          {query.isPending ? <p className="text-sm text-slate-500">Завантажую фото...</p> : null}
          {query.isError ? (
            <ErrorDetails error={query.error} label="Не вдалося відкрити фото" />
          ) : null}
          {imageFailed ? (
            <p role="alert" className="text-sm text-slate-600">
              Фото недоступне: файл міг бути видалений або старе посилання вже не діє.
            </p>
          ) : null}
          {query.data && !imageFailed ? (
            <>
              <a
                href={query.data}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-teal-700 underline"
              >
                Відкрити фото в повному розмірі
              </a>
              <img
                src={query.data}
                alt="Оригінал чека, з якого розпізнано покупку"
                className="mt-3 max-h-[80vh] max-w-full object-contain"
                onError={() => setImageFailed(true)}
              />
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
