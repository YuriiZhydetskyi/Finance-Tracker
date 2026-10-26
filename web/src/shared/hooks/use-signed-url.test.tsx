import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { IPhotoStorage } from '@/shared/lib/dependencies';
import { useSignedUrl } from './use-signed-url';

const getSignedUrl = vi.fn<(path: string) => Promise<string>>();
const storage = { getSignedUrl } as unknown as IPhotoStorage;

beforeEach(() => {
  getSignedUrl.mockReset();
  getSignedUrl.mockResolvedValue('https://signed/fresh');
});

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useSignedUrl', () => {
  it('re-signs the stored path', async () => {
    const { result } = renderHook(() => useSignedUrl(storage, 'u/a.jpg', 'https://old', true), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.data).toBe('https://signed/fresh'));
    expect(getSignedUrl).toHaveBeenCalledWith('u/a.jpg');
  });

  it('falls back to the snapshotted url when there is no path', async () => {
    const { result } = renderHook(() => useSignedUrl(storage, null, 'https://old', true), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.data).toBe('https://old'));
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('stays idle without a path or url, or while disabled', () => {
    const wrapper = makeWrapper();
    const none = renderHook(() => useSignedUrl(storage, null, null, true), { wrapper });
    const disabled = renderHook(() => useSignedUrl(storage, 'u/a.jpg', null, false), { wrapper });

    expect(none.result.current.fetchStatus).toBe('idle');
    expect(disabled.result.current.fetchStatus).toBe('idle');
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('shares one request between components that show the same photo', async () => {
    const wrapper = makeWrapper();
    const first = renderHook(() => useSignedUrl(storage, 'u/a.jpg', null, true), { wrapper });
    const second = renderHook(() => useSignedUrl(storage, 'u/a.jpg', null, true), { wrapper });

    await waitFor(() => expect(first.result.current.data).toBe('https://signed/fresh'));
    await waitFor(() => expect(second.result.current.data).toBe('https://signed/fresh'));
    expect(getSignedUrl).toHaveBeenCalledTimes(1);
  });
});
