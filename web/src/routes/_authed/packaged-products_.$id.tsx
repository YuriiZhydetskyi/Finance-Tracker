import { createFileRoute } from '@tanstack/react-router';
import { PackagedProductDetail } from '@/features/packaged-products';
import { PageTitle } from '@/shared/ui/PageTitle';

// The trailing underscore keeps this detail route out of the `/packaged-products`
// page's layout hierarchy while preserving the public URL `/packaged-products/$id`.
export const Route = createFileRoute('/_authed/packaged-products_/$id')({
  component: PackagedProductPage,
});

function PackagedProductPage() {
  const { id } = Route.useParams();
  return (
    <>
      <PageTitle>Пакований товар</PageTitle>
      <PackagedProductDetail id={id} />
    </>
  );
}
