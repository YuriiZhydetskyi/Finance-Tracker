import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { currentUserQueryKey, useCurrentUser } from './use-current-user';
import { useSignOutMutation } from './use-sign-out-mutation';

type AuthUser = { email: string };

const mocks = vi.hoisted(() => ({
  listeners: [] as ((user: { email: string } | null) => void)[],
  unsubscribeMock: vi.fn(),
  getCurrentUserMock: vi.fn<() => Promise<{ email: string } | null>>(),
  signOutMock: vi.fn<() => Promise<void>>(),
}));

vi.mock('@/shared/lib/dependencies', () => ({
  authService: {
    onAuthStateChange: (cb: (user: AuthUser | null) => void) => {
      mocks.listeners.push(cb);
      return mocks.unsubscribeMock;
    },
    getCurrentUser: () => mocks.getCurrentUserMock(),
    signOut: () => mocks.signOutMock(),
  },
}));

const ME: AuthUser = { email: 'me@example.com' };
const OTHER: AuthUser = { email: 'other@example.com' };

beforeEach(() => {
  mocks.listeners.length = 0;
  mocks.unsubscribeMock.mockReset();
  mocks.getCurrentUserMock.mockReset();
  mocks.getCurrentUserMock.mockResolvedValue(ME);
  mocks.signOutMock.mockReset();
  mocks.signOutMock.mockResolvedValue(undefined);
});

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { queryClient, Wrapper };
}

function emit(user: AuthUser | null) {
  act(() => {
    for (const listener of mocks.listeners) listener(user);
  });
}

describe('useCurrentUser', () => {
  it('shares one auth listener across every component that asks for the user', async () => {
    const { Wrapper } = setup();
    const { result } = renderHook(
      () => ({
        header: useCurrentUser(),
        guard: useCurrentUser(),
        form: useCurrentUser(),
        allowlist: useCurrentUser(),
      }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.header.data).toEqual(ME));
    expect(mocks.listeners).toHaveLength(1);
  });

  it('releases the listener when the last component goes away', () => {
    const { Wrapper } = setup();
    const first = renderHook(() => useCurrentUser(), { wrapper: Wrapper });
    const second = renderHook(() => useCurrentUser(), { wrapper: Wrapper });

    first.unmount();
    expect(mocks.unsubscribeMock).not.toHaveBeenCalled();
    second.unmount();
    expect(mocks.unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it('follows auth events without clearing other cached data while the identity is unchanged', async () => {
    const { queryClient, Wrapper } = setup();
    queryClient.setQueryData(['receipts'], ['kept']);
    const { result } = renderHook(() => useCurrentUser(), { wrapper: Wrapper });

    emit(ME);
    await waitFor(() => expect(result.current.data).toEqual(ME));
    emit({ email: ME.email });

    expect(result.current.data).toEqual(ME);
    expect(queryClient.getQueryData(['receipts'])).toEqual(['kept']);
  });

  it('clears every cached query when the session ends and shows the signed-out state', async () => {
    const { queryClient, Wrapper } = setup();
    queryClient.setQueryData(['receipts'], ['private']);
    queryClient.setQueryData(['stats', 'by-month'], ['private']);
    const { result } = renderHook(() => useCurrentUser(), { wrapper: Wrapper });
    emit(ME);
    await waitFor(() => expect(result.current.data).toEqual(ME));

    emit(null);

    await waitFor(() => expect(result.current.data).toBeNull());
    expect(queryClient.getQueryData(['receipts'])).toBeUndefined();
    expect(queryClient.getQueryData(['stats', 'by-month'])).toBeUndefined();
    expect(queryClient.getQueryData(currentUserQueryKey)).toBeNull();
  });

  it('clears cached data when a different person signs in', async () => {
    const { queryClient, Wrapper } = setup();
    const { result } = renderHook(() => useCurrentUser(), { wrapper: Wrapper });
    emit(ME);
    await waitFor(() => expect(result.current.data).toEqual(ME));
    queryClient.setQueryData(['receipts'], ['mine']);

    emit(OTHER);

    await waitFor(() => expect(result.current.data).toEqual(OTHER));
    expect(queryClient.getQueryData(['receipts'])).toBeUndefined();
  });

  it('does not treat the first event as a change of identity', async () => {
    const { queryClient, Wrapper } = setup();
    queryClient.setQueryData(['receipts'], ['kept']);
    const { result } = renderHook(() => useCurrentUser(), { wrapper: Wrapper });

    emit(ME);

    await waitFor(() => expect(result.current.data).toEqual(ME));
    expect(queryClient.getQueryData(['receipts'])).toEqual(['kept']);
  });
});

describe('useSignOutMutation', () => {
  it('clears the cache so private data does not outlive the session', async () => {
    const { queryClient, Wrapper } = setup();
    queryClient.setQueryData(['receipts'], ['private']);
    const { result } = renderHook(
      () => ({ user: useCurrentUser(), signOut: useSignOutMutation() }),
      { wrapper: Wrapper },
    );
    emit(ME);
    await waitFor(() => expect(result.current.user.data).toEqual(ME));

    await act(async () => {
      await result.current.signOut.mutateAsync();
    });

    expect(mocks.signOutMock).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(['receipts'])).toBeUndefined();
    await waitFor(() => expect(result.current.user.data).toBeNull());
  });
});
