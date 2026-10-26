import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';
import { PARSE_TIMEOUT_MS, edgeFunctionParseReceiptService } from './edge-fn-parse-receipt';

type InvokeArgs = [
  string,
  { body: Record<string, unknown>; timeout?: number; signal?: AbortSignal },
];
type InvokeResult = { data: unknown; error: { message: string } | null };
const invokeMock = vi.fn<(...args: InvokeArgs) => Promise<InvokeResult>>();

// Stub the supabase client so we don't need a session / network.
vi.mock('../supabase-client', () => ({
  supabase: {
    functions: {
      invoke: (...args: InvokeArgs) => invokeMock(...args),
    },
  },
}));

beforeEach(() => {
  invokeMock.mockReset();
});

describe('edgeFunctionParseReceiptService.parse', () => {
  const validResponse = {
    store: 'Lidl',
    date: '2026-05-04',
    currency: 'EUR',
    total_orig: 4.5,
    items: [
      {
        product_name: 'Молоко 3%',
        qty: 2,
        unit_price_orig: 1.5,
        category_suggestion: 'Молочка',
      },
      {
        product_name: 'Pfand',
        qty: 1,
        unit_price_orig: -0.25,
        category_suggestion: null,
      },
    ],
  };

  it('invokes the Edge Function with the body shape the handler expects', async () => {
    invokeMock.mockResolvedValue({ data: validResponse, error: null });

    await edgeFunctionParseReceiptService.parse({
      imageBase64: 'AAAA',
      categories: ['Молочка', 'Pfand'],
      products: [{ name: 'Молоко 3%' }],
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('parse-receipt', {
      body: {
        imageBase64: 'AAAA',
        mimeType: 'image/jpeg',
        categories: ['Молочка', 'Pfand'],
        products: [{ name: 'Молоко 3%' }],
      },
      timeout: PARSE_TIMEOUT_MS,
    });
  });

  it('gives up before the Edge Function wall-clock limit', () => {
    expect(PARSE_TIMEOUT_MS).toBeLessThan(150_000);
  });

  it('forwards the caller signal so the request can be cancelled', async () => {
    invokeMock.mockResolvedValue({ data: validResponse, error: null });
    const controller = new AbortController();

    await edgeFunctionParseReceiptService.parse({
      imageBase64: 'AAAA',
      categories: [],
      signal: controller.signal,
    });

    expect(invokeMock.mock.calls[0]?.[1].signal).toBe(controller.signal);
  });

  it('returns the parsed receipt when the response matches the schema', async () => {
    invokeMock.mockResolvedValue({ data: validResponse, error: null });
    const out = await edgeFunctionParseReceiptService.parse({
      imageBase64: 'AAAA',
      categories: ['Молочка'],
    });
    expect(out.store).toBe('Lidl');
    expect(out.items).toHaveLength(2);
    expect(out.items[1]?.unit_price_orig).toBe(-0.25);
  });

  it('throws when the Edge Function returns an error', async () => {
    invokeMock.mockResolvedValue({ data: null, error: { message: 'Forbidden' } });
    await expect(
      edgeFunctionParseReceiptService.parse({ imageBase64: 'AAAA', categories: [] }),
    ).rejects.toThrow(/Forbidden/);
  });

  it('throws when the response shape fails Zod validation', async () => {
    invokeMock.mockResolvedValue({
      data: { store: 'Lidl', currency: 'EUR' /* missing items */ },
      error: null,
    });
    await expect(
      edgeFunctionParseReceiptService.parse({ imageBase64: 'AAAA', categories: [] }),
    ).rejects.toThrow(/invalid shape/);
  });

  it('defaults missing products array to empty', async () => {
    invokeMock.mockResolvedValue({ data: validResponse, error: null });
    await edgeFunctionParseReceiptService.parse({ imageBase64: 'AAAA', categories: ['x'] });
    const callArgs = invokeMock.mock.calls[0]?.[1] as { body: { products: unknown[] } };
    expect(callArgs.body.products).toEqual([]);
  });

  // ── Error-shape edge cases ──────────────────────────────────────────────────

  it('falls back to "unknown error" when error has no message string', async () => {
    invokeMock.mockResolvedValue({
      data: null,
      // Realistic: Supabase wraps non-Error throws; the message field can be missing.
      error: {} as unknown as { message: string },
    });
    await expect(
      edgeFunctionParseReceiptService.parse({ imageBase64: 'AAAA', categories: [] }),
    ).rejects.toThrow(/parse-receipt failed: unknown error/);
  });

  it('falls back to "unknown error" when error.message is not a string', async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: { message: 12345 } as unknown as { message: string },
    });
    await expect(
      edgeFunctionParseReceiptService.parse({ imageBase64: 'AAAA', categories: [] }),
    ).rejects.toThrow(/parse-receipt failed: unknown error/);
  });

  it('throws Zod-shaped error when data is null and error is also null', async () => {
    // Ambiguous response: no error object, but data didn't come through either.
    // We expect the schema to fail fast rather than returning a malformed receipt.
    invokeMock.mockResolvedValue({ data: null, error: null });
    await expect(
      edgeFunctionParseReceiptService.parse({ imageBase64: 'AAAA', categories: [] }),
    ).rejects.toThrow(/invalid shape/);
  });

  // ── Edge Function failure bodies ────────────────────────────────────────────

  function httpError(body: string, status: number, contentType = 'application/json') {
    return new FunctionsHttpError(
      new Response(body, { status, headers: { 'Content-Type': contentType } }),
    );
  }

  it('surfaces the reason the Edge Function sent with a 502, with its status', async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: httpError(
        JSON.stringify({ error: 'AI parsing failed. gemini: quota exceeded; claude: overloaded' }),
        502,
      ),
    });

    await expect(
      edgeFunctionParseReceiptService.parse({ imageBase64: 'AAAA', categories: [] }),
    ).rejects.toThrow(
      'parse-receipt failed: HTTP 502: AI parsing failed. gemini: quota exceeded; claude: overloaded',
    );
  });

  it('keeps the 403 allowlist reason readable', async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: httpError(JSON.stringify({ error: 'Forbidden: not in allowlist' }), 403),
    });

    await expect(
      edgeFunctionParseReceiptService.parse({ imageBase64: 'AAAA', categories: [] }),
    ).rejects.toThrow('parse-receipt failed: HTTP 403: Forbidden: not in allowlist');
  });

  it('shows a plain-text failure body as is', async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: httpError('Function exceeded the compute limit', 546, 'text/plain'),
    });

    await expect(
      edgeFunctionParseReceiptService.parse({ imageBase64: 'AAAA', categories: [] }),
    ).rejects.toThrow('parse-receipt failed: HTTP 546: Function exceeded the compute limit');
  });

  it('falls back to the wrapper message when the failure body is empty', async () => {
    invokeMock.mockResolvedValue({ data: null, error: httpError('', 500) });

    await expect(
      edgeFunctionParseReceiptService.parse({ imageBase64: 'AAAA', categories: [] }),
    ).rejects.toThrow(
      'parse-receipt failed: HTTP 500: Edge Function returned a non-2xx status code',
    );
  });

  it('reads the body of a gateway relay error too', async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: new FunctionsRelayError(
        new Response(JSON.stringify({ message: 'Function not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    });

    await expect(
      edgeFunctionParseReceiptService.parse({ imageBase64: 'AAAA', categories: [] }),
    ).rejects.toThrow('parse-receipt failed: HTTP 404: Function not found');
  });

  it('keeps the original error as the cause', async () => {
    const error = httpError(JSON.stringify({ error: 'boom' }), 502);
    invokeMock.mockResolvedValue({ data: null, error });

    await expect(
      edgeFunctionParseReceiptService.parse({ imageBase64: 'AAAA', categories: [] }),
    ).rejects.toMatchObject({ cause: error });
  });

  // ── Timeout and cancellation ────────────────────────────────────────────────

  it('reports the client timeout instead of a generic network failure', async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: new FunctionsFetchError(new DOMException('The operation was aborted.', 'AbortError')),
    });

    await expect(
      edgeFunctionParseReceiptService.parse({ imageBase64: 'AAAA', categories: [] }),
    ).rejects.toThrow('parse-receipt failed: timed out after 140 s');
  });

  it('reports a caller-initiated abort as a cancellation, not a timeout', async () => {
    const controller = new AbortController();
    controller.abort();
    invokeMock.mockResolvedValue({
      data: null,
      error: new FunctionsFetchError(new DOMException('The operation was aborted.', 'AbortError')),
    });

    await expect(
      edgeFunctionParseReceiptService.parse({
        imageBase64: 'AAAA',
        categories: [],
        signal: controller.signal,
      }),
    ).rejects.toThrow('parse-receipt failed: request was cancelled');
  });

  it('passes other network failures through with their message', async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: new FunctionsFetchError(new TypeError('Failed to fetch')),
    });

    await expect(
      edgeFunctionParseReceiptService.parse({ imageBase64: 'AAAA', categories: [] }),
    ).rejects.toThrow('parse-receipt failed: Failed to send a request to the Edge Function');
  });
});
