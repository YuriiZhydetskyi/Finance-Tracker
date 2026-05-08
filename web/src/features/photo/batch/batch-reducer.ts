import { initialBatchState, type BatchAction, type BatchItem, type BatchState } from './types';

function clampIndex(index: number, length: number): number {
  if (length === 0) return 0;
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
}

function mapItem(state: BatchState, id: string, fn: (item: BatchItem) => BatchItem): BatchState {
  const idx = state.items.findIndex((i) => i.id === id);
  if (idx === -1) return state;
  const next = state.items.slice();
  next[idx] = fn(state.items[idx]!);
  return { ...state, items: next };
}

export function batchReducer(state: BatchState, action: BatchAction): BatchState {
  switch (action.type) {
    case 'enqueued': {
      if (action.items.length === 0) return state;
      const newItems: BatchItem[] = action.items.map((it) => ({
        id: it.id,
        fileName: it.fileName,
        blob: it.blob,
        previewUrl: it.previewUrl,
        attempts: 0,
        status: { kind: 'queued' },
      }));
      const wasEmpty = state.items.length === 0;
      return {
        items: [...state.items, ...newItems],
        currentIndex: wasEmpty ? 0 : state.currentIndex,
      };
    }

    case 'parseStart':
      return mapItem(state, action.id, (item) => {
        if (item.status.kind !== 'queued') return item;
        return { ...item, attempts: item.attempts + 1, status: { kind: 'parsing' } };
      });

    case 'parseSuccess':
      return mapItem(state, action.id, (item) => {
        if (item.status.kind !== 'parsing') return item;
        return {
          ...item,
          status: { kind: 'parsed', parsed: action.parsed, pairResult: action.pairResult },
        };
      });

    case 'parseError':
      return mapItem(state, action.id, (item) => {
        if (item.status.kind !== 'parsing') return item;
        return { ...item, status: { kind: 'parse-error', message: action.message } };
      });

    case 'retry':
      return mapItem(state, action.id, (item) => {
        if (item.status.kind !== 'parse-error') return item;
        return { ...item, status: { kind: 'queued' } };
      });

    case 'saveSuccess':
      return mapItem(state, action.id, (item) => {
        if (item.status.kind !== 'parsed') return item;
        return {
          ...item,
          blob: new Blob(),
          previewUrl: '',
          status: { kind: 'saved', receipt_id: action.receipt_id },
        };
      });

    case 'remove': {
      const idx = state.items.findIndex((i) => i.id === action.id);
      if (idx === -1) return state;
      const items = state.items.filter((i) => i.id !== action.id);
      const wasCurrent = idx === state.currentIndex;
      let nextIndex = state.currentIndex;
      if (idx < state.currentIndex) nextIndex = state.currentIndex - 1;
      else if (wasCurrent) nextIndex = state.currentIndex;
      return { items, currentIndex: clampIndex(nextIndex, items.length) };
    }

    case 'goto':
      return { ...state, currentIndex: clampIndex(action.index, state.items.length) };

    case 'reset':
      return initialBatchState;

    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}
