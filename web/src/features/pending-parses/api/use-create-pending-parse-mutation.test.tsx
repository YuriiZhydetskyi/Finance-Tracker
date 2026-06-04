import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCreatePendingParseMutation } from './use-create-pending-parse-mutation';

const insertMock = vi.fn<(row: unknown) => Promise<{ error: unknown }>>();
const uploadMock = vi.fn<(blob: Blob) => Promise<{ path: string; signedUrl: string }>>();
const removeMock = vi.fn<(path: string) => Promise<void>>();

vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'pending_parses') return { insert: (row: unknown) => insertMock(row) };
      throw new Error(`Unexpected table in test: ${table}`);
    },
  },
}));

vi.mock('@/shared/lib/dependencies', () => ({
  photoStorage: {
    upload: (blob: Blob) => uploadMock(blob),
    remove: (path: string) => removeMock(path),
    getSignedUrl: vi.fn(),
  },
}));

beforeEach(() => {
  insertMock.mockReset();
  uploadMock.mockReset();
  removeMock.mockReset();
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const baseVars = {
  blob: new Blob(['x'], { type: 'image/jpeg' }),
  paidBy: 'you@example.com',
  errorMessage: 'parse-receipt returned invalid shape',
  fileName: 'receipt.jpg',
  attempts: 2,
};

describe('useCreatePendingParseMutation', () => {
  it('uploads the photo then inserts a queue row referencing the path', async () => {
    uploadMock.mockResolvedValue({
      path: 'you@example.com/2026/06/A.jpg',
      signedUrl: 'https://s/A',
    });
    insertMock.mockResolvedValue({ error: null });

    const { result } = renderHook(() => useCreatePendingParseMutation(), { wrapper });

    let returned: { id: string; photo_path: string } | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync(baseVars);
    });

    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledTimes(1);
    const row = insertMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(row).toMatchObject({
      photo_path: 'you@example.com/2026/06/A.jpg',
      paid_by: 'you@example.com',
      error_message: 'parse-receipt returned invalid shape',
      attempts: 2,
      original_filename: 'receipt.jpg',
    });
    expect(typeof row.id).toBe('string');
    expect((row.id as string).length).toBe(26);
    expect(removeMock).not.toHaveBeenCalled();
    expect(returned).toEqual({ id: row.id, photo_path: 'you@example.com/2026/06/A.jpg' });
  });

  it('removes the orphan blob when the row insert fails', async () => {
    uploadMock.mockResolvedValue({
      path: 'you@example.com/2026/06/B.jpg',
      signedUrl: 'https://s/B',
    });
    insertMock.mockResolvedValue({ error: { message: 'RLS denied' } });
    removeMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useCreatePendingParseMutation(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(baseVars)).rejects.toThrow(/RLS denied/);
    });

    expect(removeMock).toHaveBeenCalledWith('you@example.com/2026/06/B.jpg');
  });

  it('does not insert when the upload itself fails', async () => {
    uploadMock.mockRejectedValue(new Error('Photo upload failed: network'));

    const { result } = renderHook(() => useCreatePendingParseMutation(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(baseVars)).rejects.toThrow(/network/);
    });

    expect(insertMock).not.toHaveBeenCalled();
    expect(removeMock).not.toHaveBeenCalled();
  });
});
