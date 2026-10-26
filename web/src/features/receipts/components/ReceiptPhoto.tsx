import { useState } from 'react';
import { photoStorage } from '@/shared/lib/dependencies';
import { useSignedUrl } from '@/shared/hooks/use-signed-url';
import { ErrorDetails } from '@/shared/ui/ErrorDetails';
import { isPdfPath } from '@/shared/utils/is-pdf-path';

type Props = Readonly<{ photoPath: string | null; photoUrl: string | null }>;

const isEmailTextPath = (path: string) => /\.txt$/i.test(path);

export function ReceiptPhoto({ photoPath, photoUrl }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const query = useSignedUrl(photoStorage, photoPath, photoUrl, expanded);
  if (!photoPath && !photoUrl) {
    return <p className="text-sm text-slate-500">Фото оригіналу для цього чека не збережено.</p>;
  }
  // Bulk imports keep PDFs and email texts as the original; an <img> cannot show them.
  if (photoPath && (isPdfPath(photoPath) || isEmailTextPath(photoPath))) {
    return <DocumentOriginal photoPath={photoPath} photoUrl={photoUrl} />;
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

function DocumentOriginal({ photoPath, photoUrl }: { photoPath: string; photoUrl: string | null }) {
  const query = useSignedUrl(photoStorage, photoPath, photoUrl, true);
  const label = isEmailTextPath(photoPath) ? 'текст листа' : 'PDF';
  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      {query.isPending ? <p className="text-sm text-slate-500">Готую посилання...</p> : null}
      {query.isError ? (
        <ErrorDetails error={query.error} label="Не вдалося відкрити оригінал" />
      ) : null}
      {query.data ? (
        <a
          href={query.data}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-medium text-teal-700 underline"
        >
          Відкрити оригінал ({label})
        </a>
      ) : null}
    </section>
  );
}
