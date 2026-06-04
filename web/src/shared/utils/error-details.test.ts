import { describe, it, expect } from 'vitest';
import { describeError, serializeErrorDetail } from './error-details';

describe('describeError', () => {
  it('wraps a plain string', () => {
    expect(describeError('oops')).toEqual({ message: 'oops' });
  });

  it('falls back for non-error junk', () => {
    expect(describeError(42)).toEqual({ message: '42' });
    expect(describeError(null)).toEqual({ message: 'null' });
    expect(describeError(undefined)).toEqual({ message: 'undefined' });
  });

  it('reads message + name from a plain Error', () => {
    const detail = describeError(new Error('boom'));
    expect(detail.message).toBe('boom');
    expect(detail.name).toBe('Error');
    expect(detail.code).toBeUndefined();
  });

  it('extracts PostgrestError code/details/hint', () => {
    const pg = {
      message: 'duplicate key value violates unique constraint',
      code: '23505',
      details: 'Key (id)=(abc) already exists.',
      hint: 'Use a different id.',
    };
    const detail = describeError(pg);
    expect(detail.code).toBe('23505');
    expect(detail.details).toBe('Key (id)=(abc) already exists.');
    expect(detail.hint).toBe('Use a different id.');
  });

  it('maps a numeric AuthError status to code when no string code', () => {
    expect(describeError({ message: 'no', status: 400 }).code).toBe('400');
    // A string code wins over status.
    expect(describeError({ message: 'no', status: 400, code: 'invalid' }).code).toBe('invalid');
  });

  it('flattens ZodError issues into "path: message" lines', () => {
    const zod = {
      name: 'ZodError',
      message: '[...]',
      issues: [
        { path: ['items', 0, 'qty'], message: 'Required' },
        { path: [], message: 'Invalid root' },
      ],
    };
    expect(describeError(zod).issues).toEqual(['items.0.qty: Required', 'Invalid root']);
  });

  it('walks the cause chain', () => {
    const inner = { message: 'RLS denied', code: '42501' };
    const detail = describeError(new Error('Receipt insert failed', { cause: inner }));
    expect(detail.message).toBe('Receipt insert failed');
    expect(detail.cause?.message).toBe('RLS denied');
    expect(detail.cause?.code).toBe('42501');
  });

  it('terminates on a cyclic cause without throwing', () => {
    const a: { message: string; cause?: unknown } = { message: 'a' };
    a.cause = a;
    expect(() => describeError(a)).not.toThrow();
    // Depth-guarded: a finite, non-circular detail is produced.
    expect(describeError(a).message).toBe('a');
  });

  it('uses a Ukrainian fallback when message is empty', () => {
    expect(describeError({ code: 'X' }).message).toBe('Невідома помилка');
  });
});

describe('serializeErrorDetail', () => {
  it('includes code, hint, issues and the nested cause', () => {
    const detail = describeError(
      new Error('Save failed', {
        cause: {
          message: 'check constraint',
          code: '23514',
          hint: 'fix the value',
          issues: undefined,
        },
      }),
    );
    const out = serializeErrorDetail(detail);
    expect(out).toContain('Save failed');
    expect(out).toContain('причина:');
    expect(out).toContain('код: 23514');
    expect(out).toContain('підказка: fix the value');
  });

  it('lists Zod issues under "проблеми"', () => {
    const detail = describeError({
      message: 'invalid',
      issues: [{ path: ['a'], message: 'Required' }],
    });
    const out = serializeErrorDetail(detail);
    expect(out).toContain('проблеми:');
    expect(out).toContain('- a: Required');
  });
});
