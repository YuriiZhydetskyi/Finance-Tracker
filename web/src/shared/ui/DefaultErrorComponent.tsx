import type { ErrorComponentProps } from '@tanstack/react-router';
import { Button } from './Button';
import { ErrorDetails } from './ErrorDetails';

// Router-level boundary: a render-time throw lands here instead of a blank
// screen, showing the full error detail + a retry.
export function DefaultErrorComponent({ error, reset }: ErrorComponentProps) {
  return (
    <div className="space-y-3 rounded-md border border-red-200 bg-red-50 p-4">
      <ErrorDetails error={error} label="Сталася помилка" />
      <Button type="button" variant="secondary" onClick={reset}>
        Спробувати знову
      </Button>
    </div>
  );
}
