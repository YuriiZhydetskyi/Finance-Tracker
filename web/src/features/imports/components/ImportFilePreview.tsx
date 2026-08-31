import { useState } from 'react';
import { Button } from '@/shared/ui/Button';
import { photoStorage } from '@/shared/lib/dependencies';
import type { ImportFile } from '../api/imports';

const PREVIEW_URL_TTL_SEC = 10 * 60;

type Props = {
  file: Pick<ImportFile, 'mime_type' | 'original_filename' | 'storage_path'>;
};

export function ImportFilePreview({ file }: Props) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [fallbackPdfUrl, setFallbackPdfUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!file.storage_path) {
    return <p className="text-xs text-slate-500">Оригінальний файл недоступний.</p>;
  }

  const isPdf = file.mime_type === 'application/pdf';

  async function handlePreview() {
    if (!file.storage_path) return;
    if (!isPdf && imageUrl) {
      setImageUrl(null);
      return;
    }

    // Open synchronously so mobile browsers do not treat the PDF tab as an
    // unsolicited popup after the signed-URL request resolves.
    const pdfWindow = isPdf ? window.open('about:blank', '_blank') : null;
    if (pdfWindow) pdfWindow.opener = null;

    setIsLoading(true);
    setError(null);
    setFallbackPdfUrl(null);
    try {
      const signedUrl = await photoStorage.getSignedUrl(file.storage_path, PREVIEW_URL_TTL_SEC);
      if (isPdf) {
        if (pdfWindow) pdfWindow.location.replace(signedUrl);
        else setFallbackPdfUrl(signedUrl);
      } else {
        setImageUrl(signedUrl);
      }
    } catch {
      pdfWindow?.close();
      setError('Не вдалося відкрити оригінал. Спробуй ще раз.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button variant="secondary" disabled={isLoading} onClick={() => void handlePreview()}>
        {isLoading
          ? 'Відкриваю…'
          : imageUrl
            ? 'Сховати оригінал'
            : isPdf
              ? 'Відкрити PDF'
              : 'Переглянути оригінал'}
      </Button>

      {fallbackPdfUrl && (
        <a
          href={fallbackPdfUrl}
          target="_blank"
          rel="noreferrer"
          className="block text-sm text-slate-700 underline"
        >
          Відкрити PDF у новій вкладці
        </a>
      )}

      {imageUrl && (
        <div className="rounded-md border border-amber-200 bg-white p-2">
          <img
            src={imageUrl}
            alt={`Оригінал ${file.original_filename}`}
            className="mx-auto max-h-[32rem] max-w-full object-contain"
          />
          <a
            href={imageUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block text-center text-xs text-slate-600 underline"
          >
            Відкрити повнорозмірне зображення
          </a>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
