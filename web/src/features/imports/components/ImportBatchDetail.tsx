import { Link } from '@tanstack/react-router';
import { Button } from '@/shared/ui/Button';
import { ErrorDetails } from '@/shared/ui/ErrorDetails';
import {
  useDiscardImportFile,
  useImportBatch,
  useRequeueImportFile,
  useResolveImportFile,
  type ImportAttempt,
  type ImportFile,
} from '../api/imports';
import { summarizeImportProgress } from '../api/import-progress';
import { ImportFilePreview } from './ImportFilePreview';

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

  const { batch, files, attemptsByFile } = query.data;
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
              attempts={attemptsByFile[file.id] ?? []}
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
        <ul className="mt-3 space-y-2 text-sm text-slate-600">
          {files.map((file) => (
            <li key={file.id} className="rounded border border-slate-100 p-2">
              <details>
                <summary className="flex cursor-pointer justify-between gap-3">
                  <span className="truncate">{file.original_filename}</span>
                  <span className="shrink-0">{STATUS_LABELS[file.status] ?? file.status}</span>
                </summary>
                <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                  <ImportFilePreview file={file} />
                  <AttemptHistory attempts={attemptsByFile[file.id] ?? []} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function ExceptionCard({
  file,
  attempts,
  busy,
  onRequeue,
  onResolve,
  onDiscard,
}: {
  file: ImportFile;
  attempts: ImportAttempt[];
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
      <ImportFilePreview file={file} />
      <AttemptHistory attempts={attempts} />
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

const ATTEMPT_STAGE_LABELS: Record<string, string> = {
  primary_parse: 'Первинне розпізнавання',
  fallback_parse: 'Резервне розпізнавання',
  independent_check: 'Незалежна перевірка',
  worker: 'Обробка та збереження',
};

const ATTEMPT_STATUS_LABELS: Record<string, string> = {
  started: 'виконується або обірвалося без завершення',
  succeeded: 'завершено',
  accepted: 'результат прийнято',
  rejected: 'результат відхилено',
  failed: 'помилка',
};

const DIAGNOSIS_LABELS: Record<string, string> = {
  tax_class_as_quantity: 'VAT-клас було прочитано як кількість',
  missing_repeated_row: 'первинний аналіз пропустив повторний рядок',
  missing_discount: 'первинний аналіз пропустив знижку або повернення',
  corrected_items: 'незалежна перевірка уточнила позиції',
  secondary_not_receipt: 'незалежна модель не підтвердила чек',
  printed_total_disagreement: 'моделі прочитали різні підсумки',
  metadata_disagreement: 'моделі не погодилися щодо реквізитів',
  secondary_arithmetic_mismatch: 'повторна арифметика теж не збіглася',
  unresolved_repeated_row_candidate: 'можливо пропущено ще один повторний рядок',
  secondary_evidence_invalid: 'незалежному результату бракує доказів',
  independent_check_required: 'результат очікує незалежної перевірки',
  incomplete_response: 'відповідь моделі обірвалася',
  missing_output: 'модель не повернула структурованих даних',
  invalid_json: 'модель повернула невалідні дані',
};

function AttemptHistory({ attempts }: { attempts: ImportAttempt[] }) {
  if (attempts.length === 0) {
    return <p className="text-xs text-slate-500">Для цього файла ще немає журналу аналізу.</p>;
  }
  const runs = groupAttemptsByRun(attempts);
  return (
    <details>
      <summary className="cursor-pointer text-xs text-slate-600 underline">
        Історія аналізу ({attempts.length})
      </summary>
      <div className="mt-2 space-y-3">
        {[...runs.entries()].map(([run, runAttempts]) => (
          <section key={run} className="rounded border border-slate-200 bg-white p-3">
            <h4 className="text-xs font-semibold text-slate-800">Запуск {run}</h4>
            <ol className="mt-2 space-y-2">
              {runAttempts.map((attempt) => (
                <li key={attempt.id} className="text-xs text-slate-700">
                  <p className="font-medium text-slate-900">
                    {ATTEMPT_STAGE_LABELS[attempt.stage] ?? attempt.stage} —{' '}
                    {ATTEMPT_STATUS_LABELS[attempt.status] ?? attempt.status}
                  </p>
                  {(attempt.provider != null || attempt.model != null) && (
                    <p>
                      {attempt.provider ?? 'provider'}
                      {attempt.model ? ` · ${attempt.model}` : ''}
                      {attempt.stop_reason ? ` · stop: ${attempt.stop_reason}` : ''}
                    </p>
                  )}
                  {attempt.printed_total != null && (
                    <p>
                      Надруковано: {formatAmount(attempt.printed_total)} · позиції:{' '}
                      {formatAmount(attempt.computed_total)} · різниця:{' '}
                      {formatAmount(attempt.difference)}
                    </p>
                  )}
                  {attempt.diagnosis_code && (
                    <p>
                      Причина: {DIAGNOSIS_LABELS[attempt.diagnosis_code] ?? attempt.diagnosis_code}
                    </p>
                  )}
                  {attempt.public_message && <p>{attempt.public_message}</p>}
                  <p className="text-slate-500">
                    {new Date(attempt.started_at).toLocaleString('uk-UA')}
                    {attempt.duration_ms != null
                      ? ` · ${(attempt.duration_ms / 1000).toFixed(1)} с`
                      : ''}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </details>
  );
}

function formatAmount(value: number | null): string {
  return value == null ? '—' : value.toFixed(2);
}

function groupAttemptsByRun(attempts: ImportAttempt[]): Map<number, ImportAttempt[]> {
  const runs = new Map<number, ImportAttempt[]>();
  for (const attempt of attempts) {
    const entries = runs.get(attempt.analysis_run) ?? [];
    entries.push(attempt);
    runs.set(attempt.analysis_run, entries);
  }
  return runs;
}
