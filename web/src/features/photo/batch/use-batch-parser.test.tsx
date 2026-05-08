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

vi.mock('../utils/resize-image', () => ({
  resizeImage: vi.fn((file: File) =>
    Promise.resolve(new Blob([file.name], { type: 'image/jpeg' })),
  ),
  blobToBase64: vi.fn(),
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
});
