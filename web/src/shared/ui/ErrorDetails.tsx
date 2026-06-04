import { useMemo, useState } from 'react';
import { cn } from './cn';
import { Button } from './Button';
import {
  describeError,
  serializeErrorDetail,
  type ErrorDetail,
} from '@/shared/utils/error-details';

type Props = {
  error: unknown;
  /** Ukrainian framing prepended to the headline, e.g. "Помилка збереження". */
  label?: string;
  className?: string;
};

function hasExtras(detail: ErrorDetail): boolean {
  return Boolean(detail.code ?? detail.details ?? detail.hint ?? detail.issues ?? detail.cause);
}

export function ErrorDetails({ error, label, className }: Props) {
  const detail = useMemo(() => describeError(error), [error]);
  const serialized = useMemo(() => serializeErrorDetail(detail), [detail]);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const handleCopy = async (): Promise<void> => {
    if (!navigator.clipboard) {
      setCopyState('failed');
      return;
    }
    try {
      await navigator.clipboard.writeText(serialized);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    window.setTimeout(() => setCopyState('idle'), 2000);
  };

  return (
    <div role="alert" className={cn('text-sm text-red-600', className)}>
      <p>{label ? `${label}: ${detail.message}` : detail.message}</p>
      {hasExtras(detail) && (
        <details className="mt-1">
          <summary className="cursor-pointer select-none text-xs text-red-500">
            Технічні деталі
          </summary>
          <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-md border border-red-200 bg-red-50 p-2 font-mono text-xs text-red-800">
            {serialized}
          </pre>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void handleCopy()}
            className="mt-1 h-8 px-3 text-xs"
          >
            {copyState === 'copied'
              ? 'Скопійовано'
              : copyState === 'failed'
                ? 'Не вдалося скопіювати'
                : 'Копіювати'}
          </Button>
        </details>
      )}
    </div>
  );
}
