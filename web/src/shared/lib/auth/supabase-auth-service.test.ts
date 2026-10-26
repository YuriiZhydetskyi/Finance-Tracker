import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabaseAuthService } from './supabase-auth-service';

type AuthEventCallback = (event: string, session: { user: { email?: string } } | null) => void;

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUser: vi.fn(),
  onAuthStateChange: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock('../supabase-client', () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      getUser: mocks.getUser,
      onAuthStateChange: mocks.onAuthStateChange,
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: mocks.unsubscribe } },
  });
});

describe('supabaseAuthService.getCurrentUser', () => {
  it('reads the stored session instead of calling the auth server', async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: { user: { email: 'me@example.com' } } },
      error: null,
    });

    await expect(supabaseAuthService.getCurrentUser()).resolves.toEqual({
      email: 'me@example.com',
    });
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('is null without a session or when the session cannot be read', async () => {
    mocks.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    await expect(supabaseAuthService.getCurrentUser()).resolves.toBeNull();

    mocks.getSession.mockResolvedValueOnce({ data: { session: null }, error: new Error('x') });
    await expect(supabaseAuthService.getCurrentUser()).resolves.toBeNull();
  });
});

describe('supabaseAuthService.onAuthStateChange', () => {
  it('forwards the replayed INITIAL_SESSION and later events without any extra request', () => {
    const cb = vi.fn();
    supabaseAuthService.onAuthStateChange(cb);
    const emit = mocks.onAuthStateChange.mock.calls[0]?.[0] as AuthEventCallback;

    emit('INITIAL_SESSION', { user: { email: 'me@example.com' } });
    emit('SIGNED_OUT', null);

    expect(cb).toHaveBeenNthCalledWith(1, { email: 'me@example.com' });
    expect(cb).toHaveBeenNthCalledWith(2, null);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('unsubscribes through the returned function', () => {
    const stop = supabaseAuthService.onAuthStateChange(vi.fn());

    stop();

    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
