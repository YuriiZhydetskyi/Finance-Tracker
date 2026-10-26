import { Link } from '@tanstack/react-router';
import { Button } from './Button';

// Router-level fallback for an address no route matches (mistyped URL, old bookmark).
export function DefaultNotFoundComponent() {
  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-white p-6 text-center">
      <h1 className="text-xl font-semibold text-slate-900">Сторінку не знайдено</h1>
      <p className="text-sm text-slate-600">
        Такої адреси немає — можливо, посилання застаріло або в ньому помилка.
      </p>
      <Link to="/">
        <Button type="button" variant="secondary">
          На головну
        </Button>
      </Link>
    </div>
  );
}
