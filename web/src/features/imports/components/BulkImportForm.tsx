import { useMemo, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useAppUsers, useCurrentUser } from '@/features/auth';
import { Button } from '@/shared/ui/Button';
import { ErrorDetails } from '@/shared/ui/ErrorDetails';
import { SELECT_CLASS } from '@/shared/ui/select-classes';
import { useCreateImportBatch, type ImportProgress } from '../api/imports';

export function BulkImportForm() {
  const navigate = useNavigate();
  const users = useAppUsers();
  const currentUser = useCurrentUser();
  const createBatch = useCreateImportBatch();
  const [files, setFiles] = useState<File[]>([]);
  const [payerOverride, setPayerOverride] = useState('');
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const options = users.data ?? [];
  const paidBy =
    payerOverride ||
    (currentUser.data?.email && options.includes(currentUser.data.email)
      ? currentUser.data.email
      : (options[0] ?? ''));
  const totalBytes = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);

  const start = async () => {
    try {
      const batchId = await createBatch.mutateAsync({ files, paidBy, onProgress: setProgress });
      await navigate({ to: '/imports/$id', params: { id: batchId } });
    } catch {
      // React Query exposes the error below; avoid an unhandled event-promise rejection.
    }
  };

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Новий великий батч</h2>
        <p className="text-sm text-slate-600">
          До 200 зображень або PDF. Один PDF вважається одним документом; після завершення
          завантаження вкладку можна закрити.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm">
        <p className="text-slate-700">
          Вже маєш JSON від Claude або Claude Code? Встав його без повторного розпізнавання.
        </p>
        <Link
          to="/photo"
          search={{ pasteJson: '1' }}
          className="font-medium text-slate-900 underline underline-offset-2 hover:text-slate-600"
        >
          Вставити готовий JSON
        </Link>
      </div>
      <label className="block space-y-1 text-sm font-medium text-slate-700">
        Файли
        <input
          type="file"
          multiple
          accept="image/*,application/pdf,.heic,.heif"
          disabled={createBatch.isPending}
          onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
          className="block w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
        />
      </label>
      {files.length > 0 && (
        <p className="text-sm text-slate-600">
          Вибрано: {files.length} · {(totalBytes / (1024 * 1024)).toFixed(1)} МБ
        </p>
      )}
      {files.length > 200 && (
        <p role="alert" className="text-sm text-red-700">
          Вибрано {files.length} файлів. Максимум для одного батчу — 200.
        </p>
      )}
      <label className="block space-y-1 text-sm font-medium text-slate-700">
        Хто оплатив усі чеки в цьому батчі
        <select
          className={SELECT_CLASS}
          value={paidBy}
          disabled={createBatch.isPending}
          onChange={(event) => setPayerOverride(event.target.value)}
        >
          {options.map((email) => (
            <option key={email} value={email}>
              {email}
            </option>
          ))}
        </select>
      </label>
      {progress && (
        <div role="status" className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {progress.phase === 'preparing' ? 'Готую та перевіряю' : 'Завантажую'}:{' '}
          {progress.completed}/{progress.total}. Не закривай вкладку до переходу на сторінку батчу.
        </div>
      )}
      {createBatch.isError && (
        <ErrorDetails error={createBatch.error} label="Не вдалося створити батч" />
      )}
      <Button
        type="button"
        disabled={files.length === 0 || files.length > 200 || !paidBy || createBatch.isPending}
        onClick={() => void start()}
      >
        {createBatch.isPending ? 'Завантажую…' : 'Завантажити й залишити у фоні'}
      </Button>
    </section>
  );
}
