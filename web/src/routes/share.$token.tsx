import { createFileRoute } from '@tanstack/react-router';
import { computePriceTrend, useSharedLink } from '@/features/products';

export const Route = createFileRoute('/share/$token')({
  component: SharedPricePage,
});

function SharedPricePage() {
  const { token } = Route.useParams();
  const link = useSharedLink(token);

  if (link.isLoading) {
    return <p className="p-6 text-sm text-slate-500">Завантажую…</p>;
  }
  if (!link.data) {
    return <p className="p-6 text-sm text-slate-600">Посилання не знайдено.</p>;
  }

  const points = link.data.snapshot;
  const trend = computePriceTrend(points);

  return (
    <div className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-xl font-bold text-slate-900">Історія цін</h1>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-slate-500">Перша</dt>
          <dd>{trend.first.toFixed(2)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Остання</dt>
          <dd>{trend.latest.toFixed(2)}</dd>
        </div>
      </dl>
      <ul className="space-y-1 text-sm">
        {points.map((p) => (
          <li key={`${p.date}-${String(p.price_orig)}`} className="flex justify-between">
            <span>{p.date}</span>
            <span>
              {p.price_orig.toFixed(2)} {p.currency}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
