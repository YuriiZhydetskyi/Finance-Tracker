import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useDeletePendingParseMutation } from './use-delete-pending-parse-mutation';

const deleteEqMock = vi.fn<(col: string, val: string) => Promise<{ error: unknown }>>();
const removeMock = vi.fn<(path: string) => Promise<void>>();

vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'pending_parses') {
        return { delete: () => ({ eq: (col: string, val: string) => deleteEqMock(col, val) }) };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
  },
}));

vi.mock('@/shared/lib/dependencies', () => ({
  photoStorage: {
    remove: (path: string) => removeMock(path),
    upload: vi.fn(),
    getSignedUrl: vi.fn(),
  },
}));

beforeEach(() => {
  deleteEqMock.mockReset();
  removeMock.mockReset();
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useDeletePendingParseMutation', () => {
  it('deletes the row only (keeps photo) when no path is given — used after save', async () => {
    deleteEqMock.mockResolvedValue({ error: null });

    const { result } = renderHook(() => useDeletePendingParseMutation(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'PP-1' });
    });

    expect(deleteEqMock).toHaveBeenCalledWith('id', 'PP-1');
    expect(removeMock).not.toHaveBeenCalled();
  });

  it('also removes the blob when removePhotoPath is given — explicit discard', async () => {
    deleteEqMock.mockResolvedValue({ error: null });
    removeMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDeletePendingParseMutation(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'PP-2', removePhotoPath: 'me/2026/06/x.jpg' });
    });

    expect(deleteEqMock).toHaveBeenCalledWith('id', 'PP-2');
    expect(removeMock).toHaveBeenCalledWith('me/2026/06/x.jpg');
  });

  it('throws when the row delete fails (and skips photo removal)', async () => {
    deleteEqMock.mockResolvedValue({ error: { message: 'RLS denied' } });

    const { result } = renderHook(() => useDeletePendingParseMutation(), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ id: 'PP-3', removePhotoPath: 'me/2026/06/x.jpg' }),
      ).rejects.toThrow(/RLS denied/);
    });

    expect(removeMock).not.toHaveBeenCalled();
  });
});
