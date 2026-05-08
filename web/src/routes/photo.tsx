import { useMemo } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { RequireAuth } from '@/features/auth';
import { useCategories } from '@/features/categories';
import { useProducts } from '@/features/products';
import { BatchReviewCarousel, PhotoPicker, useBatchParser } from '@/features/photo';

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

function PhotoFlow() {
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

      {batch.state.items.length === 0 ? (
        <PhotoPicker onPicked={handlePicked} />
      ) : (
        <BatchReviewCarousel batch={batch} />
      )}
    </div>
  );
}
