import { createFileRoute, Link } from '@tanstack/react-router';
import { RequireAuth } from '@/features/auth';
import { BulkImportForm, useImportBatches } from '@/features/imports';
import { ErrorDetails } from '@/shared/ui/ErrorDetails';

export const Route = createFileRoute('/imports')({ component: ImportsPage });

function ImportsPage() {
  return (
    <RequireAuth>
      <ImportsContent />
    </RequireAuth>
  );
}

function ImportsContent() {
  const batches = useImportBatches();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Масовий імпорт</h1>
        <p className="text-sm text-slate-600">
          Окремий режим для великої папки сканів. Звичайне додавання й ручне ревʼю лишилося у «Фото
          чек».
        </p>
      </div>
      <BulkImportForm />
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Останні батчі</h2>
        {batches.isError && <ErrorDetails error={batches.error} label="Не вдалося завантажити" />}
        {batches.data?.length === 0 && <p className="text-sm text-slate-500">Батчів ще немає.</p>}
        <ul className="space-y-2">
          {batches.data?.map((batch) => (
            <li key={batch.id}>
              <Link
                to="/imports/$id"
                params={{ id: batch.id }}
                className="flex justify-between rounded-md border border-slate-200 bg-white p-3 text-sm hover:bg-slate-50"
              >
                <span>{new Date(batch.created_at).toLocaleString('uk-UA')}</span>
                <span className="text-right">
                  {batchStatusLabel(batch.status)} · завершено {batch.progress.completed}/
                  {batch.progress.total}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function batchStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    uploading: 'завантаження',
    processing: 'обробка',
    completed: 'завершено',
    completed_with_exceptions: 'потрібна увага',
  };
  return labels[status] ?? status;
}
