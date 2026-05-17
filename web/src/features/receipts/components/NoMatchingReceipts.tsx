import { Button } from '@/shared/ui/Button';

type Props = {
  onClearFilters: () => void;
};

export function NoMatchingReceipts({ onClearFilters }: Props) {
  return (
    <div className="rounded-md border border-dashed border-slate-300 bg-white p-8 text-center">
      <p className="mb-1 text-sm font-medium text-slate-900">Нічого не знайдено.</p>
      <p className="mb-4 text-sm text-slate-600">За поточними фільтрами немає чеків.</p>
      <Button variant="secondary" onClick={onClearFilters}>
        Очистити фільтри
      </Button>
    </div>
  );
}
