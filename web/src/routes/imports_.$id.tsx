import { createFileRoute } from '@tanstack/react-router';
import { RequireAuth } from '@/features/auth';
import { ImportBatchDetail } from '@/features/imports';

// The trailing underscore keeps this detail route out of the `/imports` page's
// layout hierarchy while preserving the public URL `/imports/$id`.
export const Route = createFileRoute('/imports_/$id')({ component: ImportBatchPage });

function ImportBatchPage() {
  const { id } = Route.useParams();
  return (
    <RequireAuth>
      <ImportBatchDetail id={id} />
    </RequireAuth>
  );
}
