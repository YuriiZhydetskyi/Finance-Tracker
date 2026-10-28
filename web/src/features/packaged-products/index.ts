// Public surface of the packaged-products feature (Пакований товар, ADR-0027).

export { PackagedProductDetail } from './components/PackagedProductDetail';
export { PackagedProductsList } from './components/PackagedProductsList';
export { PackagingCandidatesList } from './components/PackagingCandidatesList';
export { PackagingSkippedList } from './components/PackagingSkippedList';
export { PackagingQueueScopeBar } from './components/PackagingQueueScopeBar';
export { PackagedProductJsonImportDialog } from './components/PackagedProductJsonImportDialog';
export type { ImportedPackagedProduct } from './components/PackagedProductJsonImportDialog';
export { LinkStoreProductDialog } from './components/LinkStoreProductDialog';
export { ReviewFilterToggle } from './components/ReviewFilterToggle';
export { filterCatalogue, needsReview } from './utils/catalogue-filter';
export { filterSkippedProducts } from './utils/packaging-skip-reasons';

export { usePackagedProducts, usePackagedProduct } from './api/use-packaged-products';
export type { PackagedProductListRow } from './api/use-packaged-products';
export {
  usePackagingCandidates,
  usePackagingCandidatesCount,
  usePackagingQueueSummary,
  usePackagedProductStoreLabels,
} from './api/use-packaging-candidates';
export {
  PACKAGING_QUEUE_WINDOW_DAYS,
  packagingQueueRowsSince,
  packagingQueueScope,
  packagingQueueWindowStart,
} from './utils/packaging-queue-window';
export { useSkippedPackagingProducts } from './api/use-skipped-packaging-products';
export { useSavePackagedProductsMutation } from './api/use-save-packaged-products-mutation';
export {
  useLinkStoreProductMutation,
  useSkipPackagingMutation,
} from './api/use-link-store-product-mutation';

export type {
  PackagingCandidateRow,
  PackagedProductRow,
  SkippedPackagingProductRow,
} from './types';
