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
      thinkingConfig: { thinkingLevel: 'medium' },
      responseMimeType: 'application/json',
    });
    expect(request.body.generationConfig).not.toHaveProperty('temperature');
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
});
