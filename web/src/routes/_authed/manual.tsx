import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { ManualReceiptForm } from '@/features/receipts';
import { PageTitle } from '@/shared/ui/PageTitle';

const ManualSearchSchema = z.object({});

export const Route = createFileRoute('/_authed/manual')({
  component: ManualPage,
  validateSearch: ManualSearchSchema,
});

function ManualPage() {
  return (
    <div className="space-y-4">
      <PageTitle>Ручне додавання</PageTitle>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Ручне додавання</h1>
        <p className="text-sm text-slate-600">
          Введіть чек або онлайн-витрату вручну. Усі поля зберігаються одразу у БД.
        </p>
      </div>
      <ManualReceiptForm />
    </div>
  );
}
