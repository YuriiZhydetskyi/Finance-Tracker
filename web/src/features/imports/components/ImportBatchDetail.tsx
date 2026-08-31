import { Link } from '@tanstack/react-router';
import { Button } from '@/shared/ui/Button';
import { ErrorDetails } from '@/shared/ui/ErrorDetails';
import {
  useDiscardImportFile,
  useImportBatch,
  useRequeueImportFile,
  useResolveImportFile,
  type ImportFile,
} from '../api/imports';
import { summarizeImportProgress } from '../api/import-progress';

const STATUS_LABELS: Record<string, string> = {
  uploading: 'завантаження',
  queued: 'у черзі',
  processing: 'аналізується',
  saved: 'збережено',
  needs_review: 'потрібна перевірка',
  duplicate: 'дублікат файлу',
  upload_failed: 'помилка завантаження',
  discarded: 'відхилено',
};

export function ImportBatchDetail({ id }: { id: string }) {
  const query = useImportBatch(id);
  const requeue = useRequeueImportFile(id);
  const discard = useDiscardImportFile(id);
  const resolve = useResolveImportFile(id);
  if (query.isLoading) return <p className="text-sm text-slate-500">Завантажую батч…</p>;
  if (query.isError)
    return <ErrorDetails error={query.error} label="Не вдалося завантажити батч" />;
  if (!query.data) return null;

  const { batch, files } = query.data;
  const progress = summarizeImportProgress(files);
  const exceptions = files.filter((file) =>
    ['needs_review', 'duplicate', 'upload_failed'].includes(file.status),
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Масовий імпорт</h1>
        <p className="text-sm text-slate-600">
          {files.length} документів · платник {batch.paid_by}
        </p>
      </div>
      <div className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-700">
        <p role="status" aria-live="polite" className="font-medium text-slate-900">
          Завершено: {progress.completed} із {progress.total} документів
        </p>
        <p className="mt-1">
          Збережено: {progress.saved} · у роботі: {progress.active} · винятків:{' '}
          {progress.exceptions} · відхилено: {progress.discarded}
        </p>
        {progress.active > 0 ? (
          <p className="mt-1 text-slate-500">
            Обробка триває у фоні. Цю вкладку вже можна закрити.
          </p>
        ) : (
          <p className="mt-1 text-slate-500">Фонова обробка завершена.</p>
        )}
      </div>

      {exceptions.length === 0 ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          Немає документів, які потребують твоєї уваги.
        </div>
      ) : (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">Потрібна увага</h2>
          {exceptions.map((file) => (
            <ExceptionCard
              key={file.id}
              file={file}
              busy={requeue.isPending || discard.isPending || resolve.isPending}
              onRequeue={(forceReceipt, skipDuplicate) =>
                requeue.mutate({ id: file.id, forceReceipt, skipDuplicate })
              }
              onResolve={
                file.duplicate_receipt_id
                  ? () => resolve.mutate({ id: file.id, receiptId: file.duplicate_receipt_id! })
                  : undefined
              }
              onDiscard={() => discard.mutate(file)}
            />
          ))}
        </section>
      )}

      <details className="rounded-md border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-medium text-slate-800">Усі файли</summary>
        <ul className="mt-3 space-y-1 text-sm text-slate-600">
          {files.map((file) => (
            <li key={file.id} className="flex justify-between gap-3">
              <span className="truncate">{file.original_filename}</span>
              <span className="shrink-0">{STATUS_LABELS[file.status] ?? file.status}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function ExceptionCard({
  file,
  busy,
  onRequeue,
  onResolve,
  onDiscard,
}: {
  file: ImportFile;
  busy: boolean;
  onRequeue: (forceReceipt: boolean, skipDuplicate?: boolean) => void;
  onResolve?: (() => void) | undefined;
  onDiscard: () => void;
}) {
  const canRetry = file.status === 'needs_review' && file.exception_kind !== 'possible_duplicate';
  return (
    <article className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-medium text-slate-900">{file.original_filename}</h3>
          <p className="text-sm text-slate-700">{STATUS_LABELS[file.status] ?? file.status}</p>
        </div>
        {file.duplicate_receipt_id && (
          <Link
            to="/edit/$id"
            params={{ id: file.duplicate_receipt_id }}
            className="text-sm text-slate-700 underline"
          >
            Відкрити схожий чек
          </Link>
        )}
      </div>
      {file.error_message && <p className="text-sm text-slate-700">{file.error_message}</p>}
      {file.parsed_json && (
        <details>
          <summary className="cursor-pointer text-xs text-slate-600 underline">
            Показати розпізнані дані
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded bg-white p-2 text-xs">
            {JSON.stringify(file.parsed_json, null, 2)}
          </pre>
        </details>
      )}
      <div className="flex flex-wrap gap-2">
        {file.exception_kind === 'possible_duplicate' && onResolve && (
          <>
            <Button variant="secondary" disabled={busy} onClick={onResolve}>
              Це той самий чек
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => onRequeue(true, true)}>
              Це інший чек — зберегти
            </Button>
          </>
        )}
        {canRetry && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => onRequeue(file.document_kind !== 'receipt')}
          >
            {file.document_kind !== 'receipt' ? 'Це чек — повторити' : 'Повторити аналіз'}
          </Button>
        )}
        {file.status === 'upload_failed' && (
          <Link to="/imports" className="self-center text-sm text-slate-700 underline">
            Вибрати файл знову
          </Link>
        )}
        <Button variant="ghost" disabled={busy} onClick={onDiscard}>
          Відхилити
        </Button>
      </div>
    </article>
  );
}
