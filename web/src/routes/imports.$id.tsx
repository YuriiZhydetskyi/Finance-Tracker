import { createFileRoute } from '@tanstack/react-router';
import { RequireAuth } from '@/features/auth';
import { ImportBatchDetail } from '@/features/imports';

export const Route = createFileRoute('/imports/$id')({ component: ImportBatchPage });

function ImportBatchPage() {
  const { id } = Route.useParams();
  return (
    <RequireAuth>
      <ImportBatchDetail id={id} />
    </RequireAuth>
  );
}
