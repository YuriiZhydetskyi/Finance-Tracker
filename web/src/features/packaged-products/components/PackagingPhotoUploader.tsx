import { useId, useState, type ChangeEvent } from 'react';
import {
  PACKAGED_PRODUCT_PHOTO_KINDS,
  type PackagedProductPhotoKind,
} from '@finance-tracker/domain';
import { prepareFile } from '@/features/photo';
import { Button } from '@/shared/ui/Button';
import { ErrorDetails } from '@/shared/ui/ErrorDetails';
import { SELECT_CLASS } from '@/shared/ui/select-classes';
import type { PackagingPhotoUpload } from '../api/use-packaging-photos';

// Packaging photos keep more detail than receipts: at the receipt default of
// 1600px the small print of an ingredient list stops being readable, and nobody
// re-photographs a pack they have already thrown away.
const PACKAGING_RESIZE = { maxEdge: 2400, quality: 0.85 };

const KIND_LABELS: Record<PackagedProductPhotoKind, string> = {
  front: 'Лицевий бік',
  back: 'Зворот',
  nutrition: 'Харчова цінність',
  ingredients: 'Склад',
  barcode: 'Штрихкод',
  source_pdf: 'Вихідний PDF',
  other: 'Інше',
};

/** First photo is usually the front, second the back; a PDF is the source document. */
function defaultKind(index: number, mimeType: string): PackagedProductPhotoKind {
  if (mimeType === 'application/pdf') return 'source_pdf';
  if (index === 0) return 'front';
  if (index === 1) return 'back';
  return 'other';
}

type Staged = PackagingPhotoUpload & {
  id: string;
  fileName: string;
  previewUrl: string | null;
};

type Props = Readonly<{
  /** Called with the staged blobs; the caller owns the upload mutation. */
  onSubmit: (photos: PackagingPhotoUpload[]) => Promise<void>;
  submitting: boolean;
  submitLabel?: string;
}>;

export function PackagingPhotoUploader({
  onSubmit,
  submitting,
  submitLabel = 'Завантажити фото',
}: Props) {
  const inputId = useId();
  const [staged, setStaged] = useState<Staged[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const handlePick = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    if (files.length === 0) return;

    setPreparing(true);
    setError(null);
    try {
      const prepared = await Promise.all(
        files.map(async (file, index) => {
          const result = await prepareFile(file, PACKAGING_RESIZE);
          return {
            id: `${String(Date.now())}-${String(index)}-${file.name}`,
            fileName: file.name,
            blob: result.blob,
            previewUrl: result.previewUrl,
            kind: defaultKind(staged.length + index, result.mimeType),
            note: null,
          } satisfies Staged;
        }),
      );
      setStaged((current) => [...current, ...prepared]);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Не вдалося підготувати файл.'));
    } finally {
      setPreparing(false);
    }
  };

  const removeStaged = (id: string) => {
    setStaged((current) => {
      const target = current.find((photo) => photo.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter((photo) => photo.id !== id);
    });
  };

  const setKind = (id: string, kind: PackagedProductPhotoKind) => {
    setStaged((current) => current.map((photo) => (photo.id === id ? { ...photo, kind } : photo)));
  };

  const handleSubmit = async () => {
    setError(null);
    try {
      await onSubmit(staged.map(({ blob, kind, note }) => ({ blob, kind, note: note ?? null })));
      staged.forEach((photo) => {
        if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
      });
      setStaged([]);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Не вдалося завантажити фото.'));
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label
          htmlFor={inputId}
          className="inline-flex h-10 cursor-pointer items-center rounded-md bg-white px-4 text-sm font-medium text-slate-900 ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
        >
          Додати фото упаковки
        </label>
        <input
          id={inputId}
          type="file"
          accept="image/*,application/pdf,.heic,.heif"
          capture="environment"
          multiple
          className="sr-only"
          onChange={(event) => void handlePick(event)}
        />
        <p className="mt-1 text-xs text-slate-500">
          Лицевий бік, зворот, таблиця харчової цінності, склад, штрихкод. HEIC із телефона і PDF
          теж підходять.
        </p>
      </div>

      {preparing ? <p className="text-sm text-slate-500">Готую файли…</p> : null}
      {error ? <ErrorDetails error={error} label="Помилка з фото" /> : null}

      {staged.length > 0 ? (
        <>
          <ul className="space-y-2">
            {staged.map((photo) => (
              <li
                key={photo.id}
                className="flex items-center gap-3 rounded-md border border-slate-200 bg-white p-2"
              >
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded bg-slate-50">
                  {photo.previewUrl ? (
                    <img src={photo.previewUrl} alt="" className="max-h-14 object-contain" />
                  ) : (
                    <span className="text-[10px] text-slate-500">PDF</span>
                  )}
                </div>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                  {photo.fileName}
                </span>
                <select
                  aria-label={`Тип фото: ${photo.fileName}`}
                  className={`${SELECT_CLASS} w-auto`}
                  value={photo.kind}
                  onChange={(event) =>
                    setKind(photo.id, event.target.value as PackagedProductPhotoKind)
                  }
                >
                  {PACKAGED_PRODUCT_PHOTO_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {KIND_LABELS[kind]}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="ghost"
                  className="px-2"
                  disabled={submitting}
                  onClick={() => removeStaged(photo.id)}
                >
                  Прибрати
                </Button>
              </li>
            ))}
          </ul>
          <Button type="button" disabled={submitting} onClick={() => void handleSubmit()}>
            {submitting ? 'Завантажую…' : submitLabel}
          </Button>
        </>
      ) : null}
    </div>
  );
}
