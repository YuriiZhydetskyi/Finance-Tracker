import { describe, expect, it, vi } from 'vitest';
import { getFxRate } from './fx.ts';

function jsonResponse(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), { status: ok ? 200 : 503 });
}

describe('getFxRate', () => {
  it('returns 1 for EUR without calling fetch', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(getFxRate(fetchImpl, 'EUR', '2026-08-01')).resolves.toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('inverts the NBU UAH rate and rounds to 6 decimals', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse([{ rate: 45.1234 }])));
    await expect(getFxRate(fetchImpl, 'UAH', '2026-08-01')).resolves.toBe(
      Math.round((1 / 45.1234) * 1e6) / 1e6,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('valcode=EUR&date=20260801&json');
  });

  it('walks back one day per failed response and gives up after 7 attempts', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse([], false)));
    await expect(getFxRate(fetchImpl, 'UAH', '2026-08-01')).rejects.toThrow('NBU rate unavailable');
    expect(fetchImpl).toHaveBeenCalledTimes(7);
    expect(String(fetchImpl.mock.calls[6]?.[0])).toContain('date=20260726');
  });

  it('rejects unsupported currencies and missing dates', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(getFxRate(fetchImpl, 'USD', '2026-08-01')).rejects.toThrow(
      'Unsupported currency or date',
    );
    await expect(getFxRate(fetchImpl, 'UAH', null)).rejects.toThrow('Unsupported currency or date');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
