import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { RequireAuth } from '@/features/auth';
import { useCategories } from '@/features/categories';
import { useProducts } from '@/features/products';
import {
  BatchReviewCarousel,
  ManualJsonImportDialog,
  PhotoPicker,
  PhotoUploadAssign,
  useBatchParser,
  type AddFileInput,
} from '@/features/photo';
import { Button } from '@/shared/ui/Button';

const PhotoSearchSchema = z
  .object({
    pasteJson: z.literal('1').optional(),
  })
  .optional();

export const Route = createFileRoute('/photo')({
  component: PhotoPage,
  validateSearch: PhotoSearchSchema,
});

function PhotoPage() {
  return (
    <RequireAuth>
      <PhotoFlow />
    </RequireAuth>
  );
}

function PhotoFlow() {
  const categoriesQuery = useCategories();
  const productsQuery = useProducts();
  const { pasteJson } = Route.useSearch() ?? {};
  const [jsonDialogOpen, setJsonDialogOpen] = useState(pasteJson === '1');
  // Files picked but not yet assigned a payer. While set, the assignment step
  // is shown; both the initial picker and the carousel's "+ Додати ще" feed it.
  const [filesToAssign, setFilesToAssign] = useState<File[] | null>(null);

  const categoryNames = useMemo(
    () => categoriesQuery.data?.map((c) => c.name) ?? [],
    [categoriesQuery.data],
  );
  const productList = useMemo(
    () => productsQuery.data?.map((p) => ({ name: p.name })) ?? [],
    [productsQuery.data],
  );

  const batch = useBatchParser({ categories: categoryNames, products: productList });

  const handleConfirmPayers = (inputs: AddFileInput[]) => {
    void batch.addFiles(inputs);
    setFilesToAssign(null);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Фото чек</h1>
        <p className="text-sm text-slate-600">
          Сфотографуй чек або вибери з галереї. Можеш додати кілька фоток одразу — кожна стиснеться
          до 1600px та піде до AI на розпізнавання по черзі. Тримай вкладку відкритою, поки парсинг
          триває.
        </p>
      </div>

      <div className="flex justify-end">
        <Button type="button" variant="secondary" onClick={() => setJsonDialogOpen(true)}>
          Вставити готовий JSON
        </Button>
      </div>

      {filesToAssign ? (
        <PhotoUploadAssign
          files={filesToAssign}
          onConfirm={handleConfirmPayers}
          onCancel={() => setFilesToAssign(null)}
        />
      ) : batch.state.items.length === 0 ? (
        <PhotoPicker onPicked={setFilesToAssign} />
      ) : (
        <BatchReviewCarousel batch={batch} onPickMore={setFilesToAssign} />
      )}
      <ManualJsonImportDialog
        open={jsonDialogOpen}
        categories={categoryNames}
        products={productList}
        onClose={() => setJsonDialogOpen(false)}
        onImported={(parsed) => batch.addParsedReceipts(parsed)}
      />
    </div>
  );
}
