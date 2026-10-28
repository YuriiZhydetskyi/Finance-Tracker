import { useMemo, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { useAppUsers, useCurrentUser } from '@/features/auth';
import { useCategories, useCategoryNames } from '@/features/categories';
import { useCreateImportBatch } from '@/features/imports';
import { useProductTaxonomy } from '@/features/products/api/use-products';
import {
  LinkStoreProductDialog,
  PackagedProductJsonImportDialog,
  PackagedProductsList,
  PackagingCandidatesList,
  PackagingQueueScopeBar,
  PackagingSkippedList,
  ReviewFilterToggle,
  useLinkStoreProductMutation,
  usePackagedProducts,
  usePackagingCandidates,
  usePackagingQueueSummary,
  useSavePackagedProductsMutation,
  useSkipPackagingMutation,
  useSkippedPackagingProducts,
  filterCatalogue,
  filterSkippedProducts,
  needsReview,
  packagingQueueRowsSince,
  packagingQueueScope,
  packagingQueueWindowStart,
  PACKAGING_QUEUE_WINDOW_DAYS,
  type PackagingCandidateRow,
} from '@/features/packaged-products';
import { Button } from '@/shared/ui/Button';
import { Input } from '@/shared/ui/Input';
import { ErrorDetails } from '@/shared/ui/ErrorDetails';
import { PageTitle } from '@/shared/ui/PageTitle';
import type { PackagingSavePlan } from '@/features/packaged-products/api/use-save-packaged-products-mutation';

// The queue lists at most this many rows; it is far above a day's photographing, and
// below the 1000-row cap PostgREST puts on every response.
const QUEUE_ROW_LIMIT = 500;

const PackagedProductsSearchSchema = z.object({
  tab: z.enum(['catalogue', 'queue', 'skipped']).optional().catch(undefined),
  q: z.string().optional().catch(undefined),
  review: z.boolean().optional().catch(undefined),
  all: z.boolean().optional().catch(undefined),
});

export const Route = createFileRoute('/_authed/packaged-products')({
  component: PackagedProductsFlow,
  validateSearch: PackagedProductsSearchSchema,
});

function PackagedProductsFlow() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const tab = search.tab ?? 'queue';
  const query = search.q ?? '';
  const onlyNeedingReview = search.review === true;
  const showAll = search.all === true;

  // A typed query searches every row; the recency window applies only to the plain list.
  const queueScope = packagingQueueScope(query, showAll);
  const windowStart = packagingQueueWindowStart();
  const lastPurchasedSince = packagingQueueRowsSince(queueScope, windowStart);

  const categoriesQuery = useCategories();
  const categoryNames = useCategoryNames();
  const taxonomyQuery = useProductTaxonomy();
  const productsQuery = usePackagedProducts();
  const candidatesQuery = usePackagingCandidates({
    query,
    lastPurchasedSince,
    limit: QUEUE_ROW_LIMIT,
  });
  const queueSummary = usePackagingQueueSummary({ query, lastPurchasedSince: windowStart });
  const catalogueReady =
    categoriesQuery.isSuccess && taxonomyQuery.isSuccess && productsQuery.isSuccess;

  const saveProducts = useSavePackagedProductsMutation();
  const linkProduct = useLinkStoreProductMutation();
  const skipPackaging = useSkipPackagingMutation();
  // The receipt on the PDF goes through the same durable import as /imports.
  const createReceiptBatch = useCreateImportBatch();
  const appUsers = useAppUsers();
  const currentUser = useCurrentUser();
  const payerOptions = appUsers.data ?? [];
  const defaultPayer =
    currentUser.data?.email && payerOptions.includes(currentUser.data.email)
      ? currentUser.data.email
      : (payerOptions[0] ?? '');

  const [importFor, setImportFor] = useState<PackagingCandidateRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [linkFor, setLinkFor] = useState<PackagingCandidateRow | null>(null);

  const taxonomy = useMemo(
    () => ({
      families: taxonomyQuery.data?.families ?? [],
      variants: taxonomyQuery.data?.variants ?? [],
    }),
    [taxonomyQuery.data],
  );
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);

  const catalogue = useMemo(
    () => filterCatalogue(products, { query, onlyNeedingReview }),
    [products, query, onlyNeedingReview],
  );
  const reviewCount = useMemo(() => products.filter(needsReview).length, [products]);

  // Only the row actually being acted on is disabled, not the whole list.
  const busyProductId = skipPackaging.isPending
    ? (skipPackaging.variables.productIds[0] ?? null)
    : linkProduct.isPending
      ? (linkProduct.variables.productIds[0] ?? null)
      : null;

  const setSearch = (next: {
    tab?: 'catalogue' | 'queue' | 'skipped';
    q?: string;
    review?: boolean | undefined;
    all?: boolean | undefined;
  }) => {
    void navigate({
      search: (current) => ({ ...current, ...next }),
      replace: true,
    });
  };

  const handleImported = (plan: PackagingSavePlan, onProgress: (message: string) => void) =>
    saveProducts.mutateAsync({ plan, onProgress });

  // The dialog calls this once everything it was asked to do has run, so the page the
  // person lands on is not chosen before they have seen what happened to the receipt.
  const handleFinished = (saved: { id: string }[]) => {
    const first = saved[0];
    if (saved.length === 1 && first)
      void navigate({ to: '/packaged-products/$id', params: { id: first.id } });
    else setSearch({ tab: 'catalogue', q: '', review: undefined });
  };

  return (
    <div className="space-y-4">
      <PageTitle>Пакований товар</PageTitle>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Пакований товар</h1>
        <Button
          type="button"
          variant="secondary"
          disabled={!catalogueReady}
          onClick={() => {
            setImportFor(null);
            setImportOpen(true);
          }}
        >
          Додати JSON + PDF
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
            Без картки
          </Button>
          <Button
            type="button"
            variant={tab === 'catalogue' ? 'primary' : 'ghost'}
            className="h-8 px-3 text-xs"
            onClick={() => setSearch({ tab: 'catalogue' })}
          >
            Каталог
          </Button>
          <Button
            type="button"
            variant={tab === 'skipped' ? 'primary' : 'ghost'}
            className="h-8 px-3 text-xs"
            onClick={() => setSearch({ tab: 'skipped' })}
          >
            Без упаковки
          </Button>
        </div>
        <Input
          aria-label="Пошук"
          placeholder={tab === 'catalogue' ? 'Назва, бренд або штрихкод' : 'Пошук серед позицій'}
          className="max-w-xs"
          value={query}
          onChange={(event) => setSearch({ q: event.target.value })}
        />
        {tab === 'catalogue' ? (
          <ReviewFilterToggle
            checked={onlyNeedingReview}
            count={reviewCount}
            onChange={(checked) => setSearch({ review: checked ? true : undefined })}
          />
        ) : null}
      </div>

      {saveProducts.isError ? (
        <ErrorDetails error={saveProducts.error} label="Не вдалося зберегти картку" />
      ) : null}
      {categoriesQuery.isError ? (
        <ErrorDetails
          error={categoriesQuery.error}
          label="Не вдалося завантажити категорії для імпорту"
        />
      ) : null}
      {taxonomyQuery.isError ? (
        <ErrorDetails
          error={taxonomyQuery.error}
          label="Не вдалося завантажити класифікацію для імпорту"
        />
      ) : null}
      {productsQuery.isError && tab === 'queue' ? (
        <ErrorDetails error={productsQuery.error} label="Не вдалося перевірити наявні картки" />
      ) : null}
      {categoriesQuery.isPending || taxonomyQuery.isPending || productsQuery.isPending ? (
        <p className="text-sm text-slate-500">Завантажую довідники для імпорту…</p>
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
        ) : candidatesQuery.isPlaceholderData && candidatesQuery.data.length === 0 ? (
          <p className="text-sm text-slate-500">Шукаю позиції без картки…</p>
        ) : (
          <div
            aria-busy={candidatesQuery.isPlaceholderData}
            className={`space-y-3 ${candidatesQuery.isPlaceholderData ? 'opacity-60 transition-opacity' : ''}`}
          >
            <PackagingQueueScopeBar
              scope={queueScope}
              shown={candidatesQuery.data.length}
              total={queueSummary.data?.total_count ?? null}
              recent={queueSummary.data?.recent_count ?? null}
              truncated={candidatesQuery.data.length >= QUEUE_ROW_LIMIT}
              onShowAll={() => setSearch({ all: true })}
              onShowRecent={() => setSearch({ all: undefined })}
            />
            <PackagingCandidatesList
              candidates={candidatesQuery.data}
              catalogueReady={catalogueReady}
              busyProductId={busyProductId}
              emptyMessage={
                queueScope === 'recent' &&
                queueSummary.data &&
                queueSummary.data.total_count > queueSummary.data.recent_count
                  ? `За останні ${String(PACKAGING_QUEUE_WINDOW_DAYS)} днів нових позицій без картки немає. Давніші приховано — натисни «Показати всі».`
                  : undefined
              }
              onCreateCard={(candidate) => {
                setImportFor(candidate);
                setImportOpen(true);
              }}
              onLinkExisting={(candidate) => setLinkFor(candidate)}
              onSkip={(candidate) =>
                skipPackaging.mutate({ productIds: [candidate.product_id], notApplicable: true })
              }
            />
          </div>
        )
      ) : tab === 'skipped' ? (
        <SkippedPackagingTab
          query={query}
          busy={skipPackaging.isPending}
          onRestore={(productIds) => skipPackaging.mutate({ productIds, notApplicable: false })}
        />
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
              : onlyNeedingReview
                ? 'Карток, що потребують перевірки, немає.'
                : 'Каталог порожній. Створи першу картку з вкладки «Без картки».'
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
        payerOptions={payerOptions}
        defaultPayer={defaultPayer}
        onClose={() => setImportOpen(false)}
        onImported={handleImported}
        onEnqueueReceipt={({ file, paidBy }) =>
          createReceiptBatch.mutateAsync({ files: [file], paidBy })
        }
        onFinished={handleFinished}
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

// Mounted only on its tab, so the list is read when the tab is opened and not before.
function SkippedPackagingTab({
  query,
  busy,
  onRestore,
}: Readonly<{
  query: string;
  busy: boolean;
  onRestore: (productIds: string[]) => void;
}>) {
  const skippedQuery = useSkippedPackagingProducts();

  if (skippedQuery.isPending) {
    return <p className="text-sm text-slate-500">Шукаю позиції без упаковки…</p>;
  }
  if (skippedQuery.isError) {
    return (
      <ErrorDetails error={skippedQuery.error} label="Не вдалося прочитати позиції без упаковки" />
    );
  }
  return (
    <PackagingSkippedList
      rows={filterSkippedProducts(skippedQuery.data, query)}
      busy={busy}
      emptyMessage={query ? 'За цим запитом нічого не знайдено.' : 'Позицій без упаковки немає.'}
      onRestore={onRestore}
    />
  );
}
