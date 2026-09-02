import { describe, it, expect, vi } from 'vitest';
import { createHandler, type HandlerDeps } from './handler.ts';
import type { IAiProvider } from './providers/ai-provider.ts';
import type { AiContext, ParsedReceipt } from './types.ts';

// ── Stubs ────────────────────────────────────────────────────────────────────

const sampleResult: ParsedReceipt = {
  store: 'Lidl',
  date: '2026-05-04',
  currency: 'EUR',
  total_orig: 4.5,
  items: [
    {
      product_name: 'Молоко',
      qty: 2,
      unit_price_orig: 1.5,
      category_suggestion: 'Молочка',
    },
  ],
};

function provider(name: string, parseImpl: IAiProvider['parse']): IAiProvider {
  return { name, parse: parseImpl };
}

function makeDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps & {
  primaryParse: ReturnType<typeof vi.fn>;
  fallbackParse: ReturnType<typeof vi.fn>;
  isAllowed: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
} {
  const primaryParse = vi.fn<IAiProvider['parse']>(async () => sampleResult);
  const fallbackParse = vi.fn<IAiProvider['parse']>(async () => sampleResult);
  const isAllowed = vi.fn<HandlerDeps['isAllowed']>(async () => true);
  const log = vi.fn<NonNullable<HandlerDeps['log']>>();
  return {
    primary: provider('gemini', primaryParse),
    fallback: provider('claude', fallbackParse),
    isAllowed,
    log,
    ...overrides,
    primaryParse,
    fallbackParse,
    isAllowed: (overrides.isAllowed as ReturnType<typeof vi.fn>) ?? isAllowed,
    log: (overrides.log as ReturnType<typeof vi.fn>) ?? log,
  };
}

function authedReq(body: unknown, init: RequestInit = {}): Request {
  return new Request('https://example.test/parse-receipt', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-jwt',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(body),
    ...init,
  });
}

// ── CORS / method routing ────────────────────────────────────────────────────

describe('handler — CORS / method routing', () => {
  it('OPTIONS → 200 with CORS headers', async () => {
    const handler = createHandler(makeDeps());
    const res = await handler(new Request('https://e.test/', { method: 'OPTIONS' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('GET → 405', async () => {
    const handler = createHandler(makeDeps());
    const res = await handler(new Request('https://e.test/', { method: 'GET' }));
    expect(res.status).toBe(405);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Method not allowed/);
  });

  it('PUT → 405', async () => {
    const handler = createHandler(makeDeps());
    const res = await handler(new Request('https://e.test/', { method: 'PUT' }));
    expect(res.status).toBe(405);
  });
});

// ── Authorization ────────────────────────────────────────────────────────────

describe('handler — authorization', () => {
  it('missing Authorization header → 401', async () => {
    const handler = createHandler(makeDeps());
    const req = new Request('https://e.test/', {
      method: 'POST',
      body: JSON.stringify({ imageBase64: 'AAA' }),
    });
    const res = await handler(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Missing or malformed Authorization/);
  });

  it('Authorization without Bearer prefix → 401', async () => {
    const handler = createHandler(makeDeps());
    const req = new Request('https://e.test/', {
      method: 'POST',
      headers: { Authorization: 'Basic xyz' },
      body: JSON.stringify({ imageBase64: 'AAA' }),
    });
    const res = await handler(req);
    expect(res.status).toBe(401);
  });

  it('isAllowed throws → 401 "Allowlist check failed" + error log', async () => {
    const deps = makeDeps({
      isAllowed: vi.fn(async () => {
        throw new Error('rpc unavailable');
      }),
    });
    const handler = createHandler(deps);
    const res = await handler(authedReq({ imageBase64: 'AAA' }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Allowlist check failed');
    const errorLogs = deps.log.mock.calls.filter((c) => c[0] === 'error');
    expect(errorLogs.length).toBeGreaterThan(0);
    expect(String(errorLogs[0]?.[1])).toMatch(/rpc unavailable/);
  });

  it('isAllowed returns false → 403', async () => {
    const deps = makeDeps({ isAllowed: vi.fn(async () => false) });
    const handler = createHandler(deps);
    const res = await handler(authedReq({ imageBase64: 'AAA' }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not in allowlist/);
  });
});

// ── Body validation ──────────────────────────────────────────────────────────

describe('handler — body validation', () => {
  it('invalid JSON body → 400', async () => {
    const handler = createHandler(makeDeps());
    const req = new Request('https://e.test/', {
      method: 'POST',
      headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
      body: 'not-json{',
    });
    const res = await handler(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Invalid JSON body/);
  });

  it('missing imageBase64 → 400', async () => {
    const handler = createHandler(makeDeps());
    const res = await handler(authedReq({ categories: [] }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/imageBase64 is required/);
  });

  it('imageBase64 not a string → 400', async () => {
    const handler = createHandler(makeDeps());
    const res = await handler(authedReq({ imageBase64: 12345 }));
    expect(res.status).toBe(400);
  });

  it('imageBase64 empty string → 400', async () => {
    const handler = createHandler(makeDeps());
    const res = await handler(authedReq({ imageBase64: '' }));
    expect(res.status).toBe(400);
  });
});

// ── AI orchestration ─────────────────────────────────────────────────────────

describe('handler — AI orchestration', () => {
  it('primary success → 200, fallback NOT called', async () => {
    const deps = makeDeps();
    const handler = createHandler(deps);
    const res = await handler(authedReq({ imageBase64: 'AAA' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ParsedReceipt;
    expect(body.store).toBe('Lidl');
    expect(deps.primaryParse).toHaveBeenCalledTimes(1);
    expect(deps.fallbackParse).not.toHaveBeenCalled();
  });

  it('returns fiscal time when the provider also supplies a card-payment time', async () => {
    const deps = makeDeps({
      primary: provider(
        'gemini',
        vi.fn(() =>
          Promise.resolve({
            ...sampleResult,
            time: '14:06',
            fiscal_time: '14:05',
            fiscal_time_raw_text: 'Datum Uhrzeit Filiale Pos Bed Bon 02.05.26 14:05',
            payment_time: '14:06',
            payment_time_raw_text: 'Kundenbeleg Uhrzeit: 14:06:46 Uhr',
          }),
        ),
      ),
    });
    const handler = createHandler(deps);
    const res = await handler(authedReq({ imageBase64: 'AAA' }));

    expect((await res.json()) as ParsedReceipt).toMatchObject({
      time: '14:05',
      time_source: 'fiscal_receipt',
    });
  });

  it('primary fails, fallback succeeds → 200 + warn log naming both providers', async () => {
    const deps = makeDeps({
      primary: provider(
        'gemini',
        vi.fn(async () => {
          throw new Error('gemini boom');
        }),
      ),
    });
    const handler = createHandler(deps);
    const res = await handler(authedReq({ imageBase64: 'AAA' }));
    expect(res.status).toBe(200);
    expect(deps.fallbackParse).toHaveBeenCalledTimes(1);
    const warnLogs = deps.log.mock.calls.filter((c) => c[0] === 'warn');
    expect(warnLogs.length).toBeGreaterThan(0);
    const warnMsg = String(warnLogs[0]?.[1]);
    expect(warnMsg).toMatch(/gemini/);
    expect(warnMsg).toMatch(/claude/);
    expect(warnMsg).toMatch(/gemini boom/);
  });

  it('both providers fail → 502 with combined error', async () => {
    const deps = makeDeps({
      primary: provider(
        'gemini',
        vi.fn(async () => {
          throw new Error('primary down');
        }),
      ),
      fallback: provider(
        'claude',
        vi.fn(async () => {
          throw new Error('fallback down');
        }),
      ),
    });
    const handler = createHandler(deps);
    const res = await handler(authedReq({ imageBase64: 'AAA' }));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/AI parsing failed/);
    expect(body.error).toMatch(/gemini/);
    expect(body.error).toMatch(/primary down/);
    expect(body.error).toMatch(/claude/);
    expect(body.error).toMatch(/fallback down/);
  });
});

// ── Body normalization ───────────────────────────────────────────────────────

describe('handler — body normalization', () => {
  it('forwards categories + products to primary.parse, defaulting mimeType to image/jpeg', async () => {
    let captured: AiContext | undefined;
    const deps = makeDeps({
      primary: provider(
        'gemini',
        vi.fn(async (_img, ctx) => {
          captured = ctx;
          return sampleResult;
        }),
      ),
    });
    const handler = createHandler(deps);
    await handler(
      authedReq({
        imageBase64: 'AAA',
        categories: ['Молочка', 'Бакалія'],
        products: [{ name: 'Молоко' }],
      }),
    );
    expect(captured?.categories).toEqual(['Молочка', 'Бакалія']);
    expect(captured?.products).toEqual([{ name: 'Молоко' }]);
    expect(captured?.mimeType).toBe('image/jpeg');
  });

  it('non-array categories/products coerce to []', async () => {
    let captured: AiContext | undefined;
    const deps = makeDeps({
      primary: provider(
        'gemini',
        vi.fn(async (_img, ctx) => {
          captured = ctx;
          return sampleResult;
        }),
      ),
    });
    const handler = createHandler(deps);
    await handler(
      authedReq({
        imageBase64: 'AAA',
        categories: 'oops-not-an-array',
        products: { name: 'oops-not-an-array' },
      }),
    );
    expect(captured?.categories).toEqual([]);
    expect(captured?.products).toEqual([]);
  });

  it('passes through explicit mimeType (image/png)', async () => {
    let captured: AiContext | undefined;
    const deps = makeDeps({
      primary: provider(
        'gemini',
        vi.fn(async (_img, ctx) => {
          captured = ctx;
          return sampleResult;
        }),
      ),
    });
    const handler = createHandler(deps);
    await handler(authedReq({ imageBase64: 'AAA', mimeType: 'image/png' }));
    expect(captured?.mimeType).toBe('image/png');
  });

  it('passes through application/pdf mimeType to the provider', async () => {
    let captured: AiContext | undefined;
    const deps = makeDeps({
      primary: provider(
        'gemini',
        vi.fn((_img, ctx) => {
          captured = ctx;
          return Promise.resolve(sampleResult);
        }),
      ),
    });
    const handler = createHandler(deps);
    await handler(authedReq({ imageBase64: 'AAA', mimeType: 'application/pdf' }));
    expect(captured?.mimeType).toBe('application/pdf');
  });
});
