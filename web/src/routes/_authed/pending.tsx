import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { useCategoryNames } from '@/features/categories';
import { useProductNameEntries } from '@/features/products';
import { BatchReviewCarousel, useBatchLeaveGuard, useBatchParser } from '@/features/photo';
import {
  PendingList,
  fetchPendingBlob,
  useDeletePendingParseMutation,
  usePendingParses,
  type PendingParseRow,
} from '@/features/pending-parses';
import { ErrorDetails } from '@/shared/ui/ErrorDetails';
import { PageTitle } from '@/shared/ui/PageTitle';

const PendingSearchSchema = z.object({});

export const Route = createFileRoute('/_authed/pending')({
  component: PendingFlow,
  validateSearch: PendingSearchSchema,
});

function PendingFlow() {
  const categoryNames = useCategoryNames();
  const productList = useProductNameEntries();
  const pendingQuery = usePendingParses();
  const deletePending = useDeletePendingParseMutation();

  const batch = useBatchParser({ categories: categoryNames, products: productList });
  useBatchLeaveGuard(batch.state.items);

  const [preparing, setPreparing] = useState(false);
  const [prepError, setPrepError] = useState<Error | null>(null);
  const [discardingId, setDiscardingId] = useState<string | null>(null);

  const hasBatch = batch.state.items.length > 0;

  const reparse = async (rows: PendingParseRow[]) => {
    if (rows.length === 0) return;
    setPreparing(true);
    setPrepError(null);
    const settled = await Promise.allSettled(
      rows.map(async (row) => ({
        pendingId: row.id,
        photoPath: row.photo_path,
        paidBy: row.paid_by,
        fileName: row.original_filename ?? 'Чек',
        baseAttempts: row.attempts,
        blob: await fetchPendingBlob(row.photo_path),
      })),
    );
    setPreparing(false);

    const ok = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
    const failed = settled.length - ok.length;
    if (ok.length > 0) batch.hydratePending(ok);
    if (failed > 0) {
      setPrepError(new Error(`${failed} фото не вдалося завантажити з черги.`));
    }
  };

  const discard = (row: PendingParseRow) => {
    setDiscardingId(row.id);
    deletePending.mutate(
      { id: row.id, removePhotoPath: row.photo_path },
      { onSettled: () => setDiscardingId(null) },
    );
  };

  if (hasBatch) {
    return (
      <div className="space-y-4">
        <PageTitle>Повторне розпізнавання</PageTitle>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Повторне розпізнавання
          </h1>
          <p className="text-sm text-slate-600">
            Хто оплатив — уже проставлено. Перевір розпізнане і збережи.
          </p>
        </div>
        <BatchReviewCarousel batch={batch} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageTitle>Чеки з помилками</PageTitle>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Чеки з помилками</h1>
        <p className="text-sm text-slate-600">
          Тут чекають чеки, які не вдалося розпізнати. Натисни «Розпарсити», щоб спробувати ще раз —
          платника вводити не доведеться.
        </p>
      </div>

      {pendingQuery.isLoading && <p className="text-sm text-slate-500">Завантажую...</p>}
      {pendingQuery.isError && (
        <ErrorDetails error={pendingQuery.error} label="Не вдалося завантажити чергу" />
      )}
      {prepError && <ErrorDetails error={prepError} label="Не вдалося підготувати чеки" />}

      {pendingQuery.isSuccess && pendingQuery.data.length === 0 && (
        <div className="rounded-md border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
          Черга порожня — усі чеки розпізнані. 🎉
        </div>
      )}

      {pendingQuery.isSuccess && pendingQuery.data.length > 0 && (
        <PendingList
          rows={pendingQuery.data}
          onReparseAll={() => void reparse(pendingQuery.data)}
          onReparseOne={(row) => void reparse([row])}
          onDiscard={discard}
          isPreparing={preparing}
          discardingId={discardingId}
        />
      )}
    </div>
  );
}
