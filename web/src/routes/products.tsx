import { createFileRoute } from '@tanstack/react-router';
import { RequireAuth } from '@/features/auth';
import { ProductInsights } from '@/features/products';

export const Route = createFileRoute('/products')({
  component: ProductsPage,
});

function ProductsPage() {
  return (
    <RequireAuth>
      <ProductInsights />
    </RequireAuth>
  );
}
