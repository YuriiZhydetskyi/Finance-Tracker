import { describe, expect, it } from 'vitest';
import { queryClient } from './query-client';

type RetryFunction = (failureCount: number, error: unknown) => boolean;

const retry = queryClient.getDefaultOptions().queries?.retry as RetryFunction;

describe('queryClient default retry', () => {
  it('does not retry a PostgrestError from an RLS denial', () => {
    const error = { code: '42501', message: 'permission denied', details: '', hint: '' };
    expect(retry(0, error)).toBe(false);
  });

  it('does not retry an HTTP 401 error', () => {
    expect(retry(0, { status: 401 })).toBe(false);
  });

  it('retries an ordinary error', () => {
    expect(retry(0, new Error('network down'))).toBe(true);
  });
});
