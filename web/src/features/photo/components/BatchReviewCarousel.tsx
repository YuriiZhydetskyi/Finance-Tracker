import { useEffect, useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/shared/ui/Button';
import { cn } from '@/shared/ui/cn';
import type { useBatchParser } from '../batch/use-batch-parser';
import { MAX_RETRY_ATTEMPTS, type BatchItem } from '../batch/types';
import { PhotoReviewForm } from './PhotoReviewForm';

type BatchHandle = ReturnType<typeof useBatchParser>;

type Props = {
  batch: BatchHandle;
};

const AUTO_ADVANCE_MS = 800;

function statusLabel(item: BatchItem): string {
  switch (item.status.kind) {
    case 'queued':
      return 'Очікує черги';
    case 'parsing':
      return 'Розпізнаю чек...';
    case 'parsed':
      return 'Готовий до огляду';
    case 'parse-error':
      return 'Помилка розпізнавання';
    case 'saved':
      return 'Збережено';
  }
}

function dotClass(item: BatchItem, isCurrent: boolean): string {
  const base = 'h-2.5 w-2.5 rounded-full transition';
  const ring = isCurrent ? 'ring-2 ring-slate-900 ring-offset-1' : '';
  switch (item.status.kind) {
    case 'queued':
      return cn(base, ring, 'bg-slate-300');
    case 'parsing':
      return cn(base, ring, 'bg-blue-400 animate-pulse');
    case 'parsed':
      return cn(base, ring, 'bg-green-500');
    case 'saved':
      return cn(base, ring, 'bg-green-700');
    case 'parse-error':
      return cn(base, ring, 'bg-red-500');
  }
}

export function BatchReviewCarousel({ batch }: Props) {
  const { state, addFiles, retryItem, removeItem, markSaved, goto, reset } = batch;
  const { items, currentIndex } = state;
  const current = items[currentIndex];

  const summary = useMemo(() => {
    const total = items.length;
    const saved = items.filter((i) => i.status.kind === 'saved').length;
    const failed = items.filter((i) => i.status.kind === 'parse-error').length;
    return { total, saved, failed };
  }, [items]);

  const allSaved = items.length > 0 && items.every((i) => i.status.kind === 'saved');

  useEffect(() => {
    if (current?.status.kind !== 'saved') return;
    const nextIdx = items.findIndex((i, idx) => idx > currentIndex && i.status.kind !== 'saved');
    if (nextIdx === -1) return;
    const id = window.setTimeout(() => goto(nextIdx), AUTO_ADVANCE_MS);
    return () => {
      window.clearTimeout(id);
    };
  }, [current, currentIndex, items, goto]);

  if (allSaved) {
    return (
      <div
        data-testid="batch-summary"
        className="space-y-3 rounded-md border border-slate-200 bg-white p-4"
      >
        <h2 className="text-lg font-semibold text-slate-900">
          Збережено {summary.saved} з {summary.total}
        </h2>
        <p className="text-sm text-slate-600">Усі чеки з пачки записані.</p>
        <div className="flex flex-wrap gap-2">
          <Link to="/recent">
            <Button type="button">Перейти до списку</Button>
          </Link>
          <Button type="button" variant="ghost" onClick={reset}>
            Додати ще пачку
          </Button>
        </div>
      </div>
    );
  }

  if (!current) return null;

  const canPrev = currentIndex > 0;
  const canNext = currentIndex < items.length - 1;

  const handlePickMore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) void addFiles(files);
    e.target.value = '';
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-slate-700">
          <div>
            <span className="font-semibold text-slate-900">
              Чек {currentIndex + 1} з {items.length}
            </span>
            <span className="ml-2 text-slate-500">
              {summary.saved} збережено
              {summary.failed > 0 ? `, ${summary.failed} помилок` : ''}
            </span>
          </div>
          <label className="cursor-pointer text-sm font-medium text-slate-700 underline">
            <input
              type="file"
              accept="image/*,application/pdf,.heic,.heif"
              multiple
              className="sr-only"
              onChange={handlePickMore}
            />
            + Додати ще
          </label>
        </div>
        <div role="tablist" aria-label="Чеки в пачці" className="flex flex-wrap items-center gap-2">
          {items.map((it, idx) => (
            <button
              key={it.id}
              type="button"
              role="tab"
              aria-selected={idx === currentIndex}
              aria-label={`Чек ${idx + 1}: ${statusLabel(it)}`}
              onClick={() => goto(idx)}
              className={dotClass(it, idx === currentIndex)}
            />
          ))}
        </div>
      </div>

      <div className="flex items-stretch gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => goto(currentIndex - 1)}
          disabled={!canPrev}
          aria-label="Попередній чек"
          className="px-2"
        >
          ‹
        </Button>
        <div className="flex-1">
          <Slide
            key={current.id}
            item={current}
            onRemove={() => removeItem(current.id)}
            onRetry={() => retryItem(current.id)}
            onSaved={(receipt_id) => markSaved(current.id, receipt_id)}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          onClick={() => goto(currentIndex + 1)}
          disabled={!canNext}
          aria-label="Наступний чек"
          className="px-2"
        >
          ›
        </Button>
      </div>
    </div>
  );
}

type SlideProps = {
  item: BatchItem;
  onRemove: () => void;
  onRetry: () => void;
  onSaved: (receipt_id: string) => void;
};

function FilePreview({ item }: { item: BatchItem }) {
  if (item.previewUrl) {
    return (
      <img
        src={item.previewUrl}
        alt={item.fileName}
        className="max-h-64 w-auto rounded-md border border-slate-200 object-contain"
      />
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
      <span
        aria-hidden
        className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-xs uppercase text-slate-700"
      >
        PDF
      </span>
      <span className="truncate">{item.fileName}</span>
    </div>
  );
}

function Slide({ item, onRemove, onRetry, onSaved }: SlideProps) {
  switch (item.status.kind) {
    case 'queued':
      return (
        <div className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
          <FilePreview item={item} />
          <div className="text-sm text-slate-700">Очікує черги...</div>
          <Button type="button" variant="ghost" onClick={onRemove}>
            Видалити з пачки
          </Button>
        </div>
      );
    case 'parsing':
      return (
        <div className="space-y-3 rounded-md border border-blue-200 bg-blue-50/50 p-4">
          <FilePreview item={item} />
          <div className="text-sm text-slate-700">Розпізнаю чек... 10–30 секунд.</div>
          <Button type="button" variant="ghost" onClick={onRemove}>
            Видалити з пачки
          </Button>
        </div>
      );
    case 'parsed':
      return (
        <PhotoReviewForm
          parsed={item.status.parsed}
          pairResult={item.status.pairResult}
          photoBlob={item.source === 'file' ? item.blob : null}
          onCancel={onRemove}
          onSaved={onSaved}
        />
      );
    case 'parse-error': {
      const canRetry = item.attempts < MAX_RETRY_ATTEMPTS;
      return (
        <div className="space-y-3 rounded-md border border-red-300 bg-red-50 p-4">
          <div role="alert" className="text-sm text-red-800">
            {item.status.message}
          </div>
          <div className="flex flex-wrap gap-2">
            {canRetry ? (
              <Button type="button" onClick={onRetry}>
                Спробувати ще
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={onRemove}>
              Видалити з пачки
            </Button>
          </div>
        </div>
      );
    }
    case 'saved':
      return (
        <div className="rounded-md border border-green-300 bg-green-50 p-4 text-sm text-green-900">
          Збережено
        </div>
      );
  }
}
