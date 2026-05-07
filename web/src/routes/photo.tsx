import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { detectPairs, type ParsedReceipt, type PairDetectionResult } from '@finance-tracker/domain';
import { Button } from '@/shared/ui/Button';
import { RequireAuth } from '@/features/auth';
import { useCategories } from '@/features/categories';
import { useProducts } from '@/features/products';
import {
  PhotoPicker,
  PhotoReviewForm,
  resizeImage,
  useParseReceiptMutation,
} from '@/features/photo';

const PhotoSearchSchema = z.object({}).optional();

export const Route = createFileRoute('/photo')({
  component: PhotoPage,
  validateSearch: PhotoSearchSchema,
});

type Stage =
  | { kind: 'pick' }
  | { kind: 'parsing' }
  | { kind: 'review'; parsed: ParsedReceipt; pairResult: PairDetectionResult; blob: Blob }
  | { kind: 'parse-error'; message: string };

function PhotoPage() {
  return (
    <RequireAuth>
      <PhotoFlow />
    </RequireAuth>
  );
}

function PhotoFlow() {
  const [stage, setStage] = useState<Stage>({ kind: 'pick' });
  const parseMutation = useParseReceiptMutation();
  const categoriesQuery = useCategories();
  const productsQuery = useProducts();

  const categoryNames = useMemo(
    () => categoriesQuery.data?.map((c) => c.name) ?? [],
    [categoriesQuery.data],
  );
  const productList = useMemo(
    () => productsQuery.data?.map((p) => ({ name: p.name })) ?? [],
    [productsQuery.data],
  );

  const handlePicked = (file: File) => {
    setStage({ kind: 'parsing' });
    void (async () => {
      try {
        const blob = await resizeImage(file);
        const parsed = await parseMutation.mutateAsync({
          blob,
          categories: categoryNames,
          products: productList,
        });
        const pairResult = detectPairs(parsed.items);
        setStage({ kind: 'review', parsed, pairResult, blob });
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Не вдалося розпізнати чек.';
        setStage({ kind: 'parse-error', message });
      }
    })();
  };

  const handleResetToPick = () => {
    setStage({ kind: 'pick' });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Фото чек</h1>
        <p className="text-sm text-slate-600">
          Сфотографуй чек або вибери з галереї. Зображення стиснеться до 1600px та піде до AI на
          розпізнавання.
        </p>
      </div>

      {stage.kind === 'pick' && (
        <PhotoPicker onPicked={handlePicked} disabled={parseMutation.isPending} />
      )}

      {stage.kind === 'parsing' && (
        <div className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-700">
          Розпізнаю чек... Це може зайняти 10–30 секунд.
        </div>
      )}

      {stage.kind === 'parse-error' && (
        <div className="space-y-3">
          <div
            role="alert"
            className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800"
          >
            {stage.message}
          </div>
          <Button type="button" onClick={handleResetToPick}>
            Спробувати ще
          </Button>
        </div>
      )}

      {stage.kind === 'review' && (
        <PhotoReviewForm
          parsed={stage.parsed}
          pairResult={stage.pairResult}
          photoBlob={stage.blob}
          onCancel={handleResetToPick}
        />
      )}
    </div>
  );
}
