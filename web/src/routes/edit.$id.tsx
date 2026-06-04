import { createFileRoute, Link } from '@tanstack/react-router';
import { ErrorDetails } from '@/shared/ui/ErrorDetails';
import { RequireAuth } from '@/features/auth';
import { useReceipt, EditReceiptForm } from '@/features/receipts';

export const Route = createFileRoute('/edit/$id')({
  component: EditPage,
});

function EditPage() {
  const { id } = Route.useParams();
  return (
    <RequireAuth>
      <EditView id={id} />
    </RequireAuth>
  );
}

function EditView({ id }: { id: string }) {
  const query = useReceipt(id);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Редагувати чек</h1>
        <p className="text-sm text-slate-600">
          Зміни перезапишуть товари повністю. Якщо змінити валюту або дату — курс обміну
          перерахується автоматично.
        </p>
      </div>

      {query.isLoading && <p className="text-sm text-slate-500">Завантажую...</p>}
      {query.isError && <ErrorDetails error={query.error} label="Не вдалося завантажити" />}
      {query.isSuccess && !query.data && (
        <div className="rounded-md border border-slate-200 bg-white p-6 text-center">
          <p className="text-sm text-slate-700">Чек не знайдено.</p>
          <p className="mt-2 text-sm text-slate-500">
            <Link to="/recent" className="text-slate-900 underline">
              Назад до списку
            </Link>
          </p>
        </div>
      )}
      {query.isSuccess && query.data && (
        <EditReceiptForm receipt={query.data.receipt} items={query.data.items} />
      )}
    </div>
  );
}
