import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { RequireAuth } from '@/features/auth';
import { ManualReceiptForm } from '@/features/receipts';

const ManualSearchSchema = z.object({}).optional();

export const Route = createFileRoute('/manual')({
  component: ManualPage,
  validateSearch: ManualSearchSchema,
});

function ManualPage() {
  return (
    <RequireAuth>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Ручне додавання</h1>
          <p className="text-sm text-slate-600">
            Введіть чек або онлайн-витрату вручну. Усі поля зберігаються одразу у БД.
          </p>
        </div>
        <ManualReceiptForm />
      </div>
    </RequireAuth>
  );
}
