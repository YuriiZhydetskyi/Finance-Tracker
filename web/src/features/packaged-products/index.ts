// Public surface of the packaged-products feature (Пакований товар, ADR-0027).

export { PackagedProductDetail } from './components/PackagedProductDetail';
export { PackagedProductsList } from './components/PackagedProductsList';
export { PackagingCandidatesList } from './components/PackagingCandidatesList';
export { PackagedProductJsonImportDialog } from './components/PackagedProductJsonImportDialog';
export type { ImportedPackagedProduct } from './components/PackagedProductJsonImportDialog';
export { LinkStoreProductDialog } from './components/LinkStoreProductDialog';

export { usePackagedProducts, usePackagedProduct } from './api/use-packaged-products';
export type { PackagedProductListRow } from './api/use-packaged-products';
export {
  usePackagingCandidates,
  usePackagingCandidatesCount,
  usePackagedProductStoreLabels,
} from './api/use-packaging-candidates';
export { useSavePackagedProductsMutation } from './api/use-save-packaged-products-mutation';
export {
  useLinkStoreProductMutation,
  useSkipPackagingMutation,
} from './api/use-link-store-product-mutation';

export type { PackagingCandidateRow, PackagedProductRow } from './types';
