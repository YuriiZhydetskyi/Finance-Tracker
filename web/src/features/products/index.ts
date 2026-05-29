export { useProducts, productsQueryKey, type ProductRow } from './api/use-products';
export { useSearchProducts, searchProductsQueryKey } from './api/use-search-products';
export { usePriceHistory, priceHistoryQueryKey, type PricePoint } from './api/use-price-history';
export { computePriceTrend, type PriceTrend } from './lib/price-trend';
export { toEur } from './lib/price-math';
export { ensureProduct } from './api/upsert-product';
export { ProductInsights } from './components/ProductInsights';
