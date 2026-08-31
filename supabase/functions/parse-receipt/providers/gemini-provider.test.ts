import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from './gemini-provider.ts';
import type { AiContext } from '../types.ts';

const sampleResponse = {
  candidates: [
    {
      content: {
        parts: [
          {
            text: JSON.stringify({
              store: 'Lidl',
              date: '2026-08-31',
              currency: 'EUR',
              total_orig: 1.5,
              items: [],
            }),
          },
        ],
      },
    },
  ],
};

function ctx(mimeType: string): AiContext {
  return { categories: [], products: [], mimeType };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(sampleResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastRequest(): { url: string; body: Record<string, unknown> } {
  expect(fetchMock).toHaveBeenCalledOnce();
  const [url, init] = fetchMock.mock.calls[0]!;
  return {
    url: String(url),
    body: JSON.parse((init as RequestInit).body as string) as Record<string, unknown>,
  };
}

function mediaPart(body: Record<string, unknown>): Record<string, unknown> {
  const contents = body.contents as Array<{ parts: Array<Record<string, unknown>> }>;
  return contents[0]!.parts[1]!;
}

function promptPart(body: Record<string, unknown>): string {
  const contents = body.contents as Array<{ parts: Array<Record<string, unknown>> }>;
  return String(contents[0]!.parts[0]!.text);
}

describe('GeminiProvider — Gemini 3.7 request configuration', () => {
  it('uses Gemini 3.7, supported thinking configuration, and High for receipt images', async () => {
    const provider = new GeminiProvider({ apiKey: 'k' });
    await provider.parse('AAA', ctx('image/jpeg'));

    const request = lastRequest();
    expect(request.url).toContain('/gemini-3.7-flash:generateContent');
    expect(mediaPart(request.body)).toMatchObject({
      inline_data: { mime_type: 'image/jpeg', data: 'AAA' },
      media_resolution: { level: 'MEDIA_RESOLUTION_HIGH' },
    });
    expect(request.body.generationConfig).toMatchObject({
      thinkingConfig: { thinkingLevel: 'low' },
      responseMimeType: 'application/json',
    });
    expect(request.body.generationConfig).not.toHaveProperty('temperature');
  });

  it('applies a request timeout so the fallback has time within the Edge Function limit', async () => {
    const provider = new GeminiProvider({ apiKey: 'k', timeoutMs: 5 });
    await provider.parse('AAA', ctx('image/jpeg'));

    const [, init] = fetchMock.mock.calls[0]!;
    const signal = (init as RequestInit).signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(signal?.aborted).toBe(true);
  });

  it('uses Medium for PDFs because Ultra High is not available for PDF input', async () => {
    const provider = new GeminiProvider({ apiKey: 'k' });
    await provider.parse('PDF', ctx('application/pdf'));

    expect(mediaPart(lastRequest().body)).toMatchObject({
      inline_data: { mime_type: 'application/pdf', data: 'PDF' },
      media_resolution: { level: 'MEDIA_RESOLUTION_MEDIUM' },
    });
  });

  it('ignores a preceding thought part and parses the structured JSON text part', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { thought: true, text: 'I will inspect the receipt.' },
                  { text: JSON.stringify({ store: 'Aldi', date: null, items: [] }) },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const provider = new GeminiProvider({ apiKey: 'k' });

    await expect(provider.parse('AAA', ctx('image/jpeg'))).resolves.toMatchObject({
      store: 'Aldi',
    });
  });

  it('uses an item-only schema and anchored total for bulk arithmetic repair', async () => {
    const provider = new GeminiProvider({ apiKey: 'k' });
    await provider.repairBulkItems('PDF', ctx('application/pdf'), {
      expectedTotalOrig: 27.5,
      previousComputedTotal: 37.15,
      previousItems: [{ product_name: 'Vitamin', qty: 2, unit_price_orig: 2.25 }],
    });

    const request = lastRequest();
    const config = request.body.generationConfig as {
      responseJsonSchema: { properties: Record<string, unknown>; required: string[] };
    };
    expect(Object.keys(config.responseJsonSchema.properties)).toEqual(['items']);
    expect(config.responseJsonSchema.required).toEqual(['items']);
    expect(promptPart(request.body)).toContain('trusted printed final total is 27.50');
    expect(promptPart(request.body)).toContain('VAT class, not an item quantity');
    expect(promptPart(request.body)).toContain('Never invent an adjustment');
  });
});
