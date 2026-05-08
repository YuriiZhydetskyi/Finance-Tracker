import { afterEach, describe, expect, it, vi } from 'vitest';
import { nbuFxRateProvider, type NbuRateRow } from './nbu-fx-rate-provider';
import nbuSample from './__fixtures__/nbu-uah-sample.json';

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(impl: (url: string) => { ok: boolean; status?: number; json: () => unknown }) {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const r = impl(url);
    return Promise.resolve(
      new Response(JSON.stringify(r.json()), {
        status: r.status ?? (r.ok ? 200 : 500),
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
}

describe('NBU FX provider — drift contract', () => {
  it('fixture matches expected NBU shape', () => {
    expect(Array.isArray(nbuSample)).toBe(true);
    expect(nbuSample).toHaveLength(1);
    const row = nbuSample[0] as NbuRateRow;
    expect(row.cc).toBe('EUR');
    expect(typeof row.rate).toBe('number');
    expect(row.rate).toBeGreaterThan(20);
    expect(row.rate).toBeLessThan(100);
    expect(row.exchangedate).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
  });
});

describe('nbuFxRateProvider.getRateLive', () => {
  it('returns 1.0 for EUR without fetching', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const rate = await nbuFxRateProvider.getRateLive('EUR', '2026-05-04');
    expect(rate).toBe(1.0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws for unsupported currency', async () => {
    await expect(nbuFxRateProvider.getRateLive('USD', '2026-05-04')).rejects.toThrow(
      /FX lookup not supported/,
    );
  });

  it('inverts NBU EUR-to-UAH rate to UAH-to-EUR (rounded to 6dp)', async () => {
    mockFetch(() => ({ ok: true, json: () => nbuSample }));
    const rate = await nbuFxRateProvider.getRateLive('UAH', '2026-05-04');
    // 1 / 44.6531 ≈ 0.022395... → rounded to 6dp
    expect(rate).toBeCloseTo(0.022395, 5);
  });

  it('walks back up to 7 days when NBU returns empty', async () => {
    let calls = 0;
    mockFetch(() => {
      calls += 1;
      if (calls < 3) return { ok: true, json: () => [] };
      return { ok: true, json: () => nbuSample };
    });
    const rate = await nbuFxRateProvider.getRateLive('UAH', '2026-05-04');
    expect(calls).toBe(3);
    expect(rate).toBeGreaterThan(0);
  });

  it('throws when no rate found in the lookback window', async () => {
    mockFetch(() => ({ ok: true, json: () => [] }));
    await expect(nbuFxRateProvider.getRateLive('UAH', '2026-05-04')).rejects.toThrow(
      /No NBU UAH rate/,
    );
  });

  it('skips non-OK responses and continues walking back', async () => {
    let calls = 0;
    mockFetch(() => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 503, json: () => ({}) };
      return { ok: true, json: () => nbuSample };
    });
    const rate = await nbuFxRateProvider.getRateLive('UAH', '2026-05-04');
    expect(calls).toBe(2);
    expect(rate).toBeGreaterThan(0);
  });

  // ── Bad rate values from API ────────────────────────────────────────────────

  it('skips rate = 0 (would divide by zero on inversion)', async () => {
    let calls = 0;
    mockFetch(() => {
      calls += 1;
      if (calls === 1) return { ok: true, json: () => [{ cc: 'EUR', rate: 0 }] };
      return { ok: true, json: () => nbuSample };
    });
    const rate = await nbuFxRateProvider.getRateLive('UAH', '2026-05-04');
    expect(calls).toBe(2);
    expect(rate).toBeGreaterThan(0);
  });

  it('skips negative rate', async () => {
    let calls = 0;
    mockFetch(() => {
      calls += 1;
      if (calls === 1) return { ok: true, json: () => [{ cc: 'EUR', rate: -5 }] };
      return { ok: true, json: () => nbuSample };
    });
    const rate = await nbuFxRateProvider.getRateLive('UAH', '2026-05-04');
    expect(calls).toBe(2);
    expect(rate).toBeGreaterThan(0);
  });

  it('skips non-numeric rate', async () => {
    let calls = 0;
    mockFetch(() => {
      calls += 1;
      if (calls === 1) return { ok: true, json: () => [{ cc: 'EUR', rate: 'oops' }] };
      return { ok: true, json: () => nbuSample };
    });
    const rate = await nbuFxRateProvider.getRateLive('UAH', '2026-05-04');
    expect(calls).toBe(2);
    expect(rate).toBeGreaterThan(0);
  });

  // ── Date arithmetic boundaries ──────────────────────────────────────────────

  it('walk-back across a month boundary uses correct prior-month dates', async () => {
    // Start 2026-04-02; after empty hits we expect 04-02, 04-01, 03-31, 03-30, ...
    const queriedDates: string[] = [];
    mockFetch((url) => {
      const m = /date=(\d{8})/.exec(url);
      if (m?.[1]) queriedDates.push(m[1]);
      return { ok: true, json: () => [] };
    });
    await expect(nbuFxRateProvider.getRateLive('UAH', '2026-04-02')).rejects.toThrow();
    expect(queriedDates).toEqual([
      '20260402',
      '20260401',
      '20260331',
      '20260330',
      '20260329',
      '20260328',
      '20260327',
    ]);
  });

  it('walk-back across the spring DST transition does not double-step', async () => {
    // 2026-03-30 → walk back through 03-29 (DST jump) → 03-23. Berlin/Kyiv DST shouldn't
    // shift the calendar date even though setHours-like maths would in some impls.
    const queriedDates: string[] = [];
    mockFetch((url) => {
      const m = /date=(\d{8})/.exec(url);
      if (m?.[1]) queriedDates.push(m[1]);
      return { ok: true, json: () => [] };
    });
    await expect(nbuFxRateProvider.getRateLive('UAH', '2026-03-30')).rejects.toThrow();
    expect(queriedDates).toEqual([
      '20260330',
      '20260329',
      '20260328',
      '20260327',
      '20260326',
      '20260325',
      '20260324',
    ]);
  });
});
