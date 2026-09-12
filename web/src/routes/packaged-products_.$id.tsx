import { createFileRoute } from '@tanstack/react-router';
import { RequireAuth } from '@/features/auth';
import { PackagedProductDetail } from '@/features/packaged-products';

// The trailing underscore keeps this detail route out of the `/packaged-products`
// page's layout hierarchy while preserving the public URL `/packaged-products/$id`.
export const Route = createFileRoute('/packaged-products_/$id')({
  component: PackagedProductPage,
});

function PackagedProductPage() {
  const { id } = Route.useParams();
  return (
    <RequireAuth>
      <PackagedProductDetail id={id} />
    </RequireAuth>
  );
}
