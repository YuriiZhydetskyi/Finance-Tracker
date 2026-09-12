import { useState } from 'react';
import type { PackagedProductPhotoKind } from '@finance-tracker/domain';
import { packagingPhotoStorage } from '@/shared/lib/dependencies';
import { useSignedUrl } from '@/shared/hooks/use-signed-url';
import { isPdfPath } from '@/shared/utils/is-pdf-path';
import { Button } from '@/shared/ui/Button';
import type { PackagedProductPhotoRow } from '../types';

const KIND_LABELS: Record<PackagedProductPhotoKind, string> = {
  front: 'Лицевий бік',
  back: 'Зворот',
  nutrition: 'Харчова цінність',
  ingredients: 'Склад',
  barcode: 'Штрихкод',
  source_pdf: 'Вихідний PDF',
  other: 'Інше',
};

function PhotoTile({
  photo,
  onDelete,
  deleting,
}: Readonly<{
  photo: PackagedProductPhotoRow;
  onDelete?: ((photo: PackagedProductPhotoRow) => void) | undefined;
  deleting: boolean;
}>) {
  const [failed, setFailed] = useState(false);
  const query = useSignedUrl(packagingPhotoStorage, photo.storage_path, null, true);
  const isPdf = isPdfPath(photo.storage_path);

  return (
    <figure className="rounded-md border border-slate-200 bg-white p-2">
      <div className="flex h-40 items-center justify-center overflow-hidden rounded bg-slate-50">
        {query.isPending ? <span className="text-xs text-slate-500">Завантажую…</span> : null}
        {query.isError || failed ? (
          <span className="px-2 text-center text-xs text-slate-600">Фото недоступне</span>
        ) : null}
        {query.data && !failed ? (
          isPdf ? (
            <a
              href={query.data}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-teal-700 underline"
            >
              Відкрити PDF
            </a>
          ) : (
            <a href={query.data} target="_blank" rel="noreferrer">
              <img
                src={query.data}
                alt={KIND_LABELS[photo.kind]}
                className="max-h-40 object-contain"
                onError={() => setFailed(true)}
              />
            </a>
          )
        ) : null}
      </div>
      <figcaption className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-slate-600">{KIND_LABELS[photo.kind]}</span>
        {onDelete ? (
          <Button
            type="button"
            variant="ghost"
            className="px-2 py-0.5 text-xs"
            disabled={deleting}
            onClick={() => onDelete(photo)}
          >
            Видалити
          </Button>
        ) : null}
      </figcaption>
    </figure>
  );
}

type Props = Readonly<{
  photos: PackagedProductPhotoRow[];
  onDelete?: ((photo: PackagedProductPhotoRow) => void) | undefined;
  deleting?: boolean;
}>;

export function PackagingPhotoGallery({ photos, onDelete, deleting = false }: Props) {
  if (photos.length === 0) {
    return <p className="text-sm text-slate-500">Фото упаковки ще не завантажено.</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {photos.map((photo) => (
        <PhotoTile key={photo.id} photo={photo} onDelete={onDelete} deleting={deleting} />
      ))}
    </div>
  );
}
