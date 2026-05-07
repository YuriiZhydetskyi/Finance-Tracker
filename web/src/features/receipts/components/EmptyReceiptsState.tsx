import { Link } from '@tanstack/react-router';
import { Button } from '@/shared/ui/Button';

export function EmptyReceiptsState() {
  return (
    <div className="rounded-md border border-dashed border-slate-300 bg-white p-8 text-center">
      <p className="mb-1 text-sm font-medium text-slate-900">Поки що порожньо.</p>
      <p className="mb-4 text-sm text-slate-600">Додай перший чек.</p>
      <div className="flex justify-center gap-2">
        <Link to="/manual">
          <Button>Вручну</Button>
        </Link>
      </div>
    </div>
  );
}
