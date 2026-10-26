import { useState } from 'react';
import { Button } from '@/shared/ui/Button';
import { ErrorDetails } from '@/shared/ui/ErrorDetails';
import { useResumeImportUploads, type ImportUploadTarget } from '../api/imports';

type Props = {
  batchId: string;
  targets: ImportUploadTarget[];
};

export function ImportUploadResume({ batchId, targets }: Props) {
  const resume = useResumeImportUploads(batchId);
  const [files, setFiles] = useState<File[]>([]);

  if (targets.length === 0) return null;

  const start = async () => {
    try {
      await resume.mutateAsync({ files, targets });
      setFiles([]);
    } catch {
      // React Query exposes the error below; avoid an unhandled event-promise rejection.
    }
  };

  return (
    <section className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-slate-800">
      <div>
        <h2 className="font-semibold text-slate-900">
          Не завантажено: {targets.length} {targets.length === 1 ? 'файл' : 'файлів'}
        </h2>
        <p className="mt-1">
          Ці файли не дійшли до сховища, тому не обробляються. Вибери їх ще раз — я знайду потрібні
          за вмістом і дозавантажу лише їх. Якщо завантаження ще триває в іншій вкладці, зачекай.
        </p>
      </div>
      <details>
        <summary className="cursor-pointer text-xs text-slate-600 underline">
          Які саме файли
        </summary>
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-700">
          {targets.map((target) => (
            <li key={target.id}>{target.original_filename}</li>
          ))}
        </ul>
      </details>
      <input
        type="file"
        multiple
        aria-label="Файли для дозавантаження"
        accept="image/*,application/pdf,.heic,.heif"
        disabled={resume.isPending}
        onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
        className="block w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
      />
      <Button
        type="button"
        variant="secondary"
        disabled={files.length === 0 || resume.isPending}
        onClick={() => void start()}
      >
        {resume.isPending ? 'Дозавантажую…' : 'Продовжити завантаження'}
      </Button>
      {resume.isSuccess && (
        <p role="status">
          Дозавантажено: {resume.data.resumed}
          {resume.data.unmatched > 0 &&
            ` · не підійшло до жодного з очікуваних файлів: ${String(resume.data.unmatched)}`}
        </p>
      )}
      {resume.isError && <ErrorDetails error={resume.error} label="Не вдалося дозавантажити" />}
    </section>
  );
}
