import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAllowlistCheck } from './use-allowlist-check';

const mocks = vi.hoisted(() => ({
  user: { data: null as { email: string } | null | undefined },
  eqMock: vi.fn<(col: string, val: string) => void>(),
  maybeSingleMock: vi.fn<() => Promise<{ data: unknown; error: null }>>(),
  fromMock: vi.fn<(table: string) => void>(),
}));

vi.mock('./use-current-user', () => ({ useCurrentUser: () => mocks.user }));
vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: {
    from: (table: string) => {
      mocks.fromMock(table);
      const chain = {
        select: () => chain,
        eq: (col: string, val: string) => {
          mocks.eqMock(col, val);
          return chain;
        },
        maybeSingle: () => mocks.maybeSingleMock(),
      };
      return chain;
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function Wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useAllowlistCheck', () => {
  it('does not query before a user is known', () => {
    mocks.user.data = null;

    const { result } = renderHook(() => useAllowlistCheck(), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(mocks.fromMock).not.toHaveBeenCalled();
  });

  it('is true when the email is in app_users', async () => {
    mocks.user.data = { email: 'me@example.com' };
    mocks.maybeSingleMock.mockResolvedValue({ data: { email: 'me@example.com' }, error: null });

    const { result } = renderHook(() => useAllowlistCheck(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.data).toBe(true));
    expect(mocks.eqMock).toHaveBeenCalledWith('email', 'me@example.com');
  });

  it('is false when RLS hides the row', async () => {
    mocks.user.data = { email: 'stranger@example.com' };
    mocks.maybeSingleMock.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useAllowlistCheck(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.data).toBe(false));
  });
});
