export const packagedProductsQueryKey = ['packaged-products'] as const;
export const packagedProductQueryKey = (id: string) => ['packaged-products', id] as const;
export const packagedProductPhotosQueryKey = (id: string) =>
  ['packaged-products', id, 'photos'] as const;
export const packagedProductStoreLabelsQueryKey = (id: string) =>
  ['packaged-products', id, 'store-labels'] as const;
export const packagingCandidatesQueryKey = ['packaging-candidates'] as const;
export const packagingCandidatesCountQueryKey = ['packaging-candidates', 'count'] as const;
