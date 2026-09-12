import { useMemo, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { RequireAuth } from '@/features/auth';
import { useCategories } from '@/features/categories';
import { useProductTaxonomy } from '@/features/products/api/use-products';
import {
  LinkStoreProductDialog,
  PackagedProductJsonImportDialog,
  PackagedProductsList,
  PackagingCandidatesList,
  useLinkStoreProductMutation,
  usePackagedProducts,
  usePackagingCandidates,
  useSavePackagedProductsMutation,
  useSkipPackagingMutation,
  type ImportedPackagedProduct,
  type PackagingCandidateRow,
} from '@/features/packaged-products';
import { Button } from '@/shared/ui/Button';
import { Input } from '@/shared/ui/Input';
import { ErrorDetails } from '@/shared/ui/ErrorDetails';

const PackagedProductsSearchSchema = z
  .object({
    tab: z.enum(['catalogue', 'queue']).optional(),
    q: z.string().optional(),
  })
  .optional();

export const Route = createFileRoute('/packaged-products')({
  component: PackagedProductsPage,
  validateSearch: PackagedProductsSearchSchema,
});

function PackagedProductsPage() {
  return (
    <RequireAuth>
      <PackagedProductsFlow />
    </RequireAuth>
  );
}

function PackagedProductsFlow() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const tab = search?.tab ?? 'queue';
  const query = search?.q ?? '';

  const categoriesQuery = useCategories();
  const taxonomyQuery = useProductTaxonomy();
  const productsQuery = usePackagedProducts();
  const candidatesQuery = usePackagingCandidates({ query });

  const saveProducts = useSavePackagedProductsMutation();
  const linkProduct = useLinkStoreProductMutation();
  const skipPackaging = useSkipPackagingMutation();

  const [importFor, setImportFor] = useState<PackagingCandidateRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [linkFor, setLinkFor] = useState<PackagingCandidateRow | null>(null);

  const categoryNames = useMemo(
    () => categoriesQuery.data?.map((c) => c.name) ?? [],
    [categoriesQuery.data],
  );
  const taxonomy = useMemo(
    () => ({
      families: taxonomyQuery.data?.families ?? [],
      variants: taxonomyQuery.data?.variants ?? [],
    }),
    [taxonomyQuery.data],
  );
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);

  const catalogue = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return products;
    return products.filter(
      (product) =>
        product.name.toLowerCase().includes(needle) ||
        (product.brand?.toLowerCase().includes(needle) ?? false) ||
        (product.barcode?.includes(needle) ?? false),
    );
  }, [products, query]);

  // Only the row actually being acted on is disabled, not the whole list.
  const busyProductId = skipPackaging.isPending
    ? (skipPackaging.variables.productIds[0] ?? null)
    : linkProduct.isPending
      ? (linkProduct.variables.productIds[0] ?? null)
      : null;

  const setSearch = (next: { tab?: 'catalogue' | 'queue'; q?: string }) => {
    void navigate({
      search: (current) => ({ ...current, ...next }),
      replace: true,
    });
  };

  const handleImported = async (imported: ImportedPackagedProduct[]) => {
    const saved = await saveProducts.mutateAsync({
      imports: imported,
      linkProductIds: importFor ? [importFor.product_id] : [],
    });
    const first = saved[0];
    if (first) void navigate({ to: '/packaged-products/$id', params: { id: first.id } });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Пакований товар</h1>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setImportFor(null);
            setImportOpen(true);
          }}
        >
          Додати з JSON
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-slate-300 bg-white p-0.5">
          <Button
            type="button"
            variant={tab === 'queue' ? 'primary' : 'ghost'}
            className="h-8 px-3 text-xs"
            onClick={() => setSearch({ tab: 'queue' })}
          >
            Сфотографувати
          </Button>
          <Button
            type="button"
            variant={tab === 'catalogue' ? 'primary' : 'ghost'}
            className="h-8 px-3 text-xs"
            onClick={() => setSearch({ tab: 'catalogue' })}
          >
            Каталог
          </Button>
        </div>
        <Input
          aria-label="Пошук"
          placeholder={tab === 'queue' ? 'Пошук серед позицій' : 'Назва, бренд або штрихкод'}
          className="max-w-xs"
          value={query}
          onChange={(event) => setSearch({ q: event.target.value })}
        />
      </div>

      {saveProducts.isError ? (
        <ErrorDetails error={saveProducts.error} label="Не вдалося зберегти картку" />
      ) : null}
      {linkProduct.isError ? (
        <ErrorDetails error={linkProduct.error} label="Не вдалося привʼязати позицію" />
      ) : null}
      {skipPackaging.isError ? (
        <ErrorDetails error={skipPackaging.error} label="Не вдалося оновити позицію" />
      ) : null}

      {tab === 'queue' ? (
        candidatesQuery.isPending ? (
          <p className="text-sm text-slate-500">Шукаю позиції без картки…</p>
        ) : candidatesQuery.isError ? (
          <ErrorDetails error={candidatesQuery.error} label="Не вдалося прочитати чергу" />
        ) : (
          <PackagingCandidatesList
            candidates={candidatesQuery.data}
            busyProductId={busyProductId}
            onCreateCard={(candidate) => {
              setImportFor(candidate);
              setImportOpen(true);
            }}
            onLinkExisting={(candidate) => setLinkFor(candidate)}
            onSkip={(candidate) =>
              skipPackaging.mutate({ productIds: [candidate.product_id], notApplicable: true })
            }
          />
        )
      ) : productsQuery.isPending ? (
        <p className="text-sm text-slate-500">Завантажую каталог…</p>
      ) : productsQuery.isError ? (
        <ErrorDetails error={productsQuery.error} label="Не вдалося прочитати каталог" />
      ) : (
        <PackagedProductsList
          products={catalogue}
          emptyMessage={
            query
              ? 'За цим запитом нічого не знайдено.'
              : 'Каталог порожній. Створи першу картку з вкладки «Сфотографувати».'
          }
        />
      )}

      <PackagedProductJsonImportDialog
        open={importOpen}
        categories={categoryNames}
        taxonomy={taxonomy}
        existing={products}
        candidate={importFor}
        submitting={saveProducts.isPending}
        onClose={() => setImportOpen(false)}
        onImported={handleImported}
      />

      <LinkStoreProductDialog
        open={linkFor != null}
        candidate={linkFor}
        products={products}
        submitting={linkProduct.isPending}
        onClose={() => setLinkFor(null)}
        onLink={async (packagedProductId) => {
          if (!linkFor) return;
          await linkProduct.mutateAsync({
            productIds: [linkFor.product_id],
            packagedProductId,
          });
          setLinkFor(null);
        }}
      />
    </div>
  );
}
