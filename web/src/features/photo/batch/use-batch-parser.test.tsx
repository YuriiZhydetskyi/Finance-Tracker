import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ParsedReceipt } from '@finance-tracker/domain';
import { useBatchParser } from './use-batch-parser';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const parseMock = vi.fn<(args: { blob: Blob }) => Promise<ParsedReceipt>>();

vi.mock('../api/use-parse-receipt-mutation', () => ({
  useParseReceiptMutation: () => ({ mutateAsync: parseMock }),
}));

vi.mock('../utils/prepare-file', () => ({
  prepareFile: vi.fn((file: File) =>
    Promise.resolve({
      blob: new Blob([file.name], { type: 'image/jpeg' }),
      previewUrl: 'blob://fake',
      mimeType: 'image/jpeg',
    }),
  ),
}));

beforeEach(() => {
  parseMock.mockReset();
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob://fake');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const fakeParsed = (store: string): ParsedReceipt => ({
  store,
  date: '2026-05-04',
  currency: 'EUR',
  total_orig: 1,
  items: [],
});

function makeFile(name: string): File {
  return new File(['x'], name, { type: 'image/jpeg' });
}

describe('useBatchParser', () => {
  it('enqueues all files and starts parsing exactly one at a time (sequential)', async () => {
    const d1 = defer<ParsedReceipt>();
    const d2 = defer<ParsedReceipt>();
    const d3 = defer<ParsedReceipt>();
    parseMock.mockImplementationOnce(() => d1.promise);
    parseMock.mockImplementationOnce(() => d2.promise);
    parseMock.mockImplementationOnce(() => d3.promise);

    const { result } = renderHook(() => useBatchParser({ categories: [], products: [] }), {
      wrapper,
    });

    await act(async () => {
      await result.current.addFiles([makeFile('a.jpg'), makeFile('b.jpg'), makeFile('c.jpg')]);
    });

    await waitFor(() => {
      expect(parseMock).toHaveBeenCalledTimes(1);
    });

    const statuses = result.current.state.items.map((i) => i.status.kind);
    expect(statuses).toEqual(['parsing', 'queued', 'queued']);
  });

  it('advances to next queued item when current parse resolves', async () => {
    const d1 = defer<ParsedReceipt>();
    const d2 = defer<ParsedReceipt>();
    parseMock.mockImplementationOnce(() => d1.promise);
    parseMock.mockImplementationOnce(() => d2.promise);

    const { result } = renderHook(() => useBatchParser({ categories: [], products: [] }), {
      wrapper,
    });

    await act(async () => {
      await result.current.addFiles([makeFile('a.jpg'), makeFile('b.jpg')]);
    });
    await waitFor(() => expect(parseMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      d1.resolve(fakeParsed('A'));
      await d1.promise;
    });

    await waitFor(() => expect(parseMock).toHaveBeenCalledTimes(2));
    const statuses = result.current.state.items.map((i) => i.status.kind);
    expect(statuses).toEqual(['parsed', 'parsing']);
  });

  it('continues with remaining items when one parse fails', async () => {
    const d1 = defer<ParsedReceipt>();
    const d2 = defer<ParsedReceipt>();
    parseMock.mockImplementationOnce(() => d1.promise);
    parseMock.mockImplementationOnce(() => d2.promise);

    const { result } = renderHook(() => useBatchParser({ categories: [], products: [] }), {
      wrapper,
    });

    await act(async () => {
      await result.current.addFiles([makeFile('a.jpg'), makeFile('b.jpg')]);
    });
    await waitFor(() => expect(parseMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      d1.reject(new Error('boom'));
      await d1.promise.catch(() => undefined);
    });

    await waitFor(() => expect(parseMock).toHaveBeenCalledTimes(2));
    const item0 = result.current.state.items[0]!;
    expect(item0.status.kind).toBe('parse-error');
    expect(result.current.state.items[1]!.status.kind).toBe('parsing');
  });

  it('retryItem re-parses a failed item', async () => {
    const d1 = defer<ParsedReceipt>();
    const d2 = defer<ParsedReceipt>();
    parseMock.mockImplementationOnce(() => d1.promise);
    parseMock.mockImplementationOnce(() => d2.promise);

    const { result } = renderHook(() => useBatchParser({ categories: [], products: [] }), {
      wrapper,
    });

    await act(async () => {
      await result.current.addFiles([makeFile('a.jpg')]);
    });
    await waitFor(() => expect(parseMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      d1.reject(new Error('temp net'));
      await d1.promise.catch(() => undefined);
    });
    await waitFor(() => {
      expect(result.current.state.items[0]!.status.kind).toBe('parse-error');
    });

    act(() => {
      result.current.retryItem(result.current.state.items[0]!.id);
    });

    await waitFor(() => expect(parseMock).toHaveBeenCalledTimes(2));
    expect(result.current.state.items[0]!.status.kind).toBe('parsing');
    expect(result.current.state.items[0]!.attempts).toBe(2);
  });

  it('removeItem on a parsing slot survives the eventual resolve (no zombie state)', async () => {
    const d1 = defer<ParsedReceipt>();
    const d2 = defer<ParsedReceipt>();
    parseMock.mockImplementationOnce(() => d1.promise);
    parseMock.mockImplementationOnce(() => d2.promise);

    const { result } = renderHook(() => useBatchParser({ categories: [], products: [] }), {
      wrapper,
    });

    await act(async () => {
      await result.current.addFiles([makeFile('a.jpg'), makeFile('b.jpg')]);
    });
    await waitFor(() => expect(parseMock).toHaveBeenCalledTimes(1));

    const removedId = result.current.state.items[0]!.id;
    act(() => {
      result.current.removeItem(removedId);
    });

    await act(async () => {
      d1.resolve(fakeParsed('A'));
      await d1.promise;
    });

    expect(result.current.state.items).toHaveLength(1);
    expect(result.current.state.items[0]!.id).not.toBe(removedId);
  });

  it('addFiles with empty input is a no-op', async () => {
    const { result } = renderHook(() => useBatchParser({ categories: [], products: [] }), {
      wrapper,
    });
    await act(async () => {
      await result.current.addFiles([]);
    });
    expect(result.current.state.items).toHaveLength(0);
    expect(parseMock).not.toHaveBeenCalled();
  });

  it('addParsedReceipt adds pasted JSON without calling the parser', () => {
    const { result } = renderHook(() => useBatchParser({ categories: [], products: [] }), {
      wrapper,
    });

    act(() => {
      result.current.addParsedReceipt(fakeParsed('Manual'));
    });

    const item = result.current.state.items[0]!;
    expect(parseMock).not.toHaveBeenCalled();
    expect(item.source).toBe('manual-json');
    expect(item.status.kind).toBe('parsed');
    expect(item.fileName).toBe('Pasted AI JSON #1');
  });

  it('addParsedReceipt numbers repeat pastes so carousel labels stay distinguishable', () => {
    const { result } = renderHook(() => useBatchParser({ categories: [], products: [] }), {
      wrapper,
    });

    act(() => {
      result.current.addParsedReceipt(fakeParsed('First'));
    });
    act(() => {
      result.current.addParsedReceipt(fakeParsed('Second'));
    });
    act(() => {
      result.current.addParsedReceipt(fakeParsed('Third'));
    });

    expect(result.current.state.items.map((i) => i.fileName)).toEqual([
      'Pasted AI JSON #1',
      'Pasted AI JSON #2',
      'Pasted AI JSON #3',
    ]);
  });

  it('addParsedReceipts adds a whole array with sequential, non-colliding labels', () => {
    const { result } = renderHook(() => useBatchParser({ categories: [], products: [] }), {
      wrapper,
    });

    act(() => {
      result.current.addParsedReceipts([fakeParsed('A'), fakeParsed('B')]);
    });

    expect(result.current.state.items.map((i) => i.fileName)).toEqual([
      'Pasted AI JSON #1',
      'Pasted AI JSON #2',
    ]);
    expect(result.current.state.items.every((i) => i.source === 'manual-json')).toBe(true);
    // Focuses the first of the freshly pasted batch.
    expect(result.current.state.currentIndex).toBe(0);
    expect(parseMock).not.toHaveBeenCalled();
  });

  it('addParsedReceipts continues numbering after prior manual pastes', () => {
    const { result } = renderHook(() => useBatchParser({ categories: [], products: [] }), {
      wrapper,
    });

    act(() => {
      result.current.addParsedReceipt(fakeParsed('First'));
    });
    act(() => {
      result.current.addParsedReceipts([fakeParsed('Second'), fakeParsed('Third')]);
    });

    expect(result.current.state.items.map((i) => i.fileName)).toEqual([
      'Pasted AI JSON #1',
      'Pasted AI JSON #2',
      'Pasted AI JSON #3',
    ]);
  });

  it('addParsedReceipts with empty input is a no-op', () => {
    const { result } = renderHook(() => useBatchParser({ categories: [], products: [] }), {
      wrapper,
    });
    act(() => {
      result.current.addParsedReceipts([]);
    });
    expect(result.current.state.items).toHaveLength(0);
  });
});
