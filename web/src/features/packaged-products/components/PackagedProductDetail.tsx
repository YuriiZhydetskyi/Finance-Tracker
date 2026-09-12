import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { isValidGtin, type EuAllergen } from '@finance-tracker/domain';
import { Button } from '@/shared/ui/Button';
import { ErrorDetails } from '@/shared/ui/ErrorDetails';
import { formatDate } from '@/shared/utils/format-date';
import { usePackagedProduct } from '../api/use-packaged-products';
import { usePackagedProductStoreLabels } from '../api/use-packaging-candidates';
import {
  useDeletePackagingPhotoMutation,
  usePackagedProductPhotos,
  useUploadPackagingPhotosMutation,
} from '../api/use-packaging-photos';
import { useDeletePackagedProductMutation } from '../api/use-update-packaged-product-mutation';
import { useLinkStoreProductMutation } from '../api/use-link-store-product-mutation';
import { NutritionFactsTable } from './NutritionFactsTable';
import { PackagingPhotoGallery } from './PackagingPhotoGallery';
import { PackagingPhotoUploader } from './PackagingPhotoUploader';
import { StoreLabelsTable } from './StoreLabelsTable';
import type { PackagedProductRow } from '../types';

const ALLERGEN_LABELS: Record<EuAllergen, string> = {
  gluten: 'глютен',
  crustaceans: 'ракоподібні',
  eggs: 'яйця',
  fish: 'риба',
  peanuts: 'арахіс',
  soybeans: 'соя',
  milk: 'молоко',
  nuts: 'горіхи',
  celery: 'селера',
  mustard: 'гірчиця',
  sesame: 'кунжут',
  sulphites: 'сульфіти',
  lupin: 'люпин',
  molluscs: 'молюски',
};

const UNIT_LABELS = { pcs: 'шт', g: 'г', kg: 'кг', ml: 'мл', l: 'л' } as const;

function Section({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function IdentityFacts({ product }: Readonly<{ product: PackagedProductRow }>) {
  const size =
    product.package_size != null && product.package_unit != null
      ? `${String(Number(product.package_size.toFixed(3)))} ${UNIT_LABELS[product.package_unit]}`
      : null;
  const badGtin = product.barcode != null && !isValidGtin(product.barcode);

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      <dt className="text-slate-600">Бренд</dt>
      <dd className="text-slate-900">{product.brand ?? '—'}</dd>
      <dt className="text-slate-600">Категорія</dt>
      <dd className="text-slate-900">{product.category}</dd>
      <dt className="text-slate-600">Нетто</dt>
      <dd className="text-slate-900">
        {product.package_count ? `${String(product.package_count)} × ` : ''}
        {size ?? '—'}
      </dd>
      <dt className="text-slate-600">Штрихкод</dt>
      <dd className="font-mono text-slate-900">
        {product.barcode ?? '—'}
        {badGtin ? (
          <span className="ml-2 font-sans text-xs text-amber-700">
            контрольна цифра не збігається
          </span>
        ) : null}
      </dd>
      {product.nutri_score ? (
        <>
          <dt className="text-slate-600">Nutri-Score</dt>
          <dd className="text-slate-900">{product.nutri_score}</dd>
        </>
      ) : null}
      {product.is_organic != null ? (
        <>
          <dt className="text-slate-600">Органічний</dt>
          <dd className="text-slate-900">{product.is_organic ? 'так' : 'ні'}</dd>
        </>
      ) : null}
      <dt className="text-slate-600">Додано</dt>
      <dd className="text-slate-900">{formatDate(product.created_at.slice(0, 10))}</dd>
    </dl>
  );
}

export function PackagedProductDetail({ id }: Readonly<{ id: string }>) {
  const navigate = useNavigate();
  const productQuery = usePackagedProduct(id);
  const photosQuery = usePackagedProductPhotos(id);
  const labelsQuery = usePackagedProductStoreLabels(id);
  const uploadPhotos = useUploadPackagingPhotosMutation();
  const deletePhoto = useDeletePackagingPhotoMutation();
  const deleteProduct = useDeletePackagedProductMutation();
  const unlink = useLinkStoreProductMutation();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (productQuery.isPending) return <p className="text-sm text-slate-500">Завантажую картку…</p>;
  if (productQuery.isError) {
    return <ErrorDetails error={productQuery.error} label="Не вдалося відкрити картку" />;
  }

  const product = productQuery.data;
  const photos = photosQuery.data ?? [];
  const nextSortOrder = photos.reduce((max, photo) => Math.max(max, photo.sort_order + 1), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/packaged-products" className="text-sm text-teal-700 underline">
            ← До каталогу
          </Link>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900">{product.name}</h1>
        </div>
        {confirmingDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-700">Видалити картку?</span>
            <Button
              type="button"
              variant="danger"
              disabled={deleteProduct.isPending}
              onClick={() =>
                deleteProduct.mutate(
                  { id },
                  { onSuccess: () => void navigate({ to: '/packaged-products' }) },
                )
              }
            >
              Так, видалити
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirmingDelete(false)}>
              Скасувати
            </Button>
          </div>
        ) : (
          <Button type="button" variant="ghost" onClick={() => setConfirmingDelete(true)}>
            Видалити картку
          </Button>
        )}
      </div>

      {deleteProduct.isError ? (
        <ErrorDetails error={deleteProduct.error} label="Не вдалося видалити" />
      ) : null}

      <Section title="Товар">
        <IdentityFacts product={product} />
      </Section>

      <Section title="Харчова цінність">
        <NutritionFactsTable product={product} />
      </Section>

      {product.allergens.length > 0 || product.allergen_traces.length > 0 ? (
        <Section title="Алергени">
          {product.allergens.length > 0 ? (
            <p className="text-sm text-slate-900">
              Містить: {product.allergens.map((a) => ALLERGEN_LABELS[a]).join(', ')}
            </p>
          ) : null}
          {product.allergen_traces.length > 0 ? (
            <p className="mt-1 text-sm text-slate-600">
              Може містити сліди:{' '}
              {product.allergen_traces.map((a) => ALLERGEN_LABELS[a]).join(', ')}
            </p>
          ) : null}
        </Section>
      ) : null}

      {product.ingredients_text ? (
        <Section title="Склад">
          <p className="text-sm leading-6 text-slate-800">{product.ingredients_text}</p>
        </Section>
      ) : null}

      <Section title="Назви в чеках">
        {labelsQuery.isError ? (
          <ErrorDetails error={labelsQuery.error} label="Не вдалося прочитати назви" />
        ) : (
          <StoreLabelsTable
            labels={labelsQuery.data ?? []}
            unlinking={unlink.isPending}
            onUnlink={(row) =>
              unlink.mutate({ productIds: [row.product_id], packagedProductId: null })
            }
          />
        )}
      </Section>

      <Section title="Фото упаковки">
        <div className="space-y-4">
          {photosQuery.isError ? (
            <ErrorDetails error={photosQuery.error} label="Не вдалося прочитати фото" />
          ) : (
            <PackagingPhotoGallery
              photos={photos}
              deleting={deletePhoto.isPending}
              onDelete={(photo) =>
                deletePhoto.mutate({
                  id: photo.id,
                  packagedProductId: id,
                  storagePath: photo.storage_path,
                })
              }
            />
          )}
          <PackagingPhotoUploader
            submitting={uploadPhotos.isPending}
            onSubmit={async (staged) => {
              await uploadPhotos.mutateAsync({
                packagedProductId: id,
                photos: staged,
                startSortOrder: nextSortOrder,
              });
            }}
          />
        </div>
      </Section>
    </div>
  );
}
