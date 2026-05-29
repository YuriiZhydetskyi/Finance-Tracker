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
  useBatchParser,
} from '@/features/photo';
import { Button } from '@/shared/ui/Button';

const PhotoSearchSchema = z.object({}).optional();

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

/**
 * Renders the photo receipt upload and review flow with an option to paste AI-generated JSON.
 *
 * Displays a title and instructions, a right-aligned "Paste AI JSON" button to open the manual import
 * dialog, and either the photo picker (when no batch items exist) or the batch review carousel
 * (when items are present). Integrates category and product data into the batch parsing logic and
 * adds parsed receipts from the manual import into the batch.
 *
 * @returns The React element tree for the photo receipt flow UI.
 */
function PhotoFlow() {
  const categoriesQuery = useCategories();
  const productsQuery = useProducts();
  const [jsonDialogOpen, setJsonDialogOpen] = useState(false);

  const categoryNames = useMemo(
    () => categoriesQuery.data?.map((c) => c.name) ?? [],
    [categoriesQuery.data],
  );
  const productList = useMemo(
    () => productsQuery.data?.map((p) => ({ name: p.name })) ?? [],
    [productsQuery.data],
  );

  const batch = useBatchParser({ categories: categoryNames, products: productList });

  const handlePicked = (files: File[]) => {
    void batch.addFiles(files);
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
          Paste AI JSON
        </Button>
      </div>

      {batch.state.items.length === 0 ? (
        <PhotoPicker onPicked={handlePicked} />
      ) : (
        <BatchReviewCarousel batch={batch} />
      )}
      <ManualJsonImportDialog
        open={jsonDialogOpen}
        categories={categoryNames}
        products={productList}
        onClose={() => setJsonDialogOpen(false)}
        onImported={(parsed) => batch.addParsedReceipt(parsed)}
      />
    </div>
  );
}
