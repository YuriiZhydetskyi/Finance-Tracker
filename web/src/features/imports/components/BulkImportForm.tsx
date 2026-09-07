import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { ParsedReceipt } from '@finance-tracker/domain';
import { useAppUsers, useCurrentUser } from '@/features/auth';
import { useCategories } from '@/features/categories';
import { useProducts } from '@/features/products';
import { ManualJsonImportDialog } from '@/features/photo';
import { Button } from '@/shared/ui/Button';
import { ErrorDetails } from '@/shared/ui/ErrorDetails';
import { SELECT_CLASS } from '@/shared/ui/select-classes';
import {
  useCreateImportBatch,
  useCreateManualJsonImportBatch,
  type ImportProgress,
} from '../api/imports';

export function BulkImportForm() {
  const navigate = useNavigate();
  const users = useAppUsers();
  const currentUser = useCurrentUser();
  const createBatch = useCreateImportBatch();
  const createManualJsonBatch = useCreateManualJsonImportBatch();
  const categories = useCategories();
  const products = useProducts();
  const [files, setFiles] = useState<File[]>([]);
  const [payerOverride, setPayerOverride] = useState('');
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [jsonDialogOpen, setJsonDialogOpen] = useState(false);
  const options = users.data ?? [];
  const paidBy =
    payerOverride ||
    (currentUser.data?.email && options.includes(currentUser.data.email)
      ? currentUser.data.email
      : (options[0] ?? ''));
  const totalBytes = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);
  const categoryNames = useMemo(
    () => categories.data?.map((category) => category.name) ?? [],
    [categories.data],
  );
  const productList = useMemo(
    () => products.data?.map((product) => ({ name: product.name })) ?? [],
    [products.data],
  );
  const isBusy = createBatch.isPending || createManualJsonBatch.isPending;

  const start = async () => {
    try {
      const batchId = await createBatch.mutateAsync({ files, paidBy, onProgress: setProgress });
      await navigate({ to: '/imports/$id', params: { id: batchId } });
    } catch {
      // React Query exposes the error below; avoid an unhandled event-promise rejection.
    }
  };

  const startManualJsonBatch = async (receipts: ParsedReceipt[]) => {
    const batchId = await createManualJsonBatch.mutateAsync({ receipts, paidBy });
    await navigate({ to: '/imports/$id', params: { id: batchId } });
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
          Маєш готовий JSON — зокрема експорт Amazon? Встав його тут: кожне замовлення піде в
          окремий запис цього durable-батчу без повторного OCR.
        </p>
        <Button
          type="button"
          variant="secondary"
          disabled={!paidBy || isBusy}
          onClick={() => setJsonDialogOpen(true)}
        >
          Вставити JSON у батч
        </Button>
      </div>
      <label className="block space-y-1 text-sm font-medium text-slate-700">
        Файли
        <input
          type="file"
          multiple
          accept="image/*,application/pdf,.heic,.heif"
          disabled={isBusy}
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
          disabled={isBusy}
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
      {createManualJsonBatch.isError && (
        <ErrorDetails error={createManualJsonBatch.error} label="Не вдалося створити JSON-батч" />
      )}
      <Button
        type="button"
        disabled={files.length === 0 || files.length > 200 || !paidBy || isBusy}
        onClick={() => void start()}
      >
        {createBatch.isPending ? 'Завантажую…' : 'Завантажити й залишити у фоні'}
      </Button>
      <ManualJsonImportDialog
        open={jsonDialogOpen}
        categories={categoryNames}
        products={productList}
        title="Вставити JSON у фоновий батч"
        description="Перевіримо всі чеки, а потім надішлемо їх у durable-чергу без повторного OCR."
        submitLabel="Перевірити й запустити батч"
        showPrompt={false}
        onClose={() => setJsonDialogOpen(false)}
        onImported={(receipts) => startManualJsonBatch(receipts)}
      />
    </section>
  );
}
