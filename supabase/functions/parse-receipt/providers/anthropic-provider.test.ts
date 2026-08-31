import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from './anthropic-provider.ts';
import type { AiContext } from '../types.ts';

const sampleToolUse = {
  content: [
    {
      type: 'tool_use',
      name: 'record_receipt',
      input: {
        store: 'Lidl',
        date: '2026-05-04',
        currency: 'EUR',
        total_orig: 1.5,
        items: [],
      },
    },
  ],
};

function ok(): Response {
  return new Response(JSON.stringify(sampleToolUse), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function ctx(mimeType: string): AiContext {
  return { categories: [], products: [], mimeType };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve(ok()));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastRequestBody(): {
  messages: Array<{ content: Array<Record<string, unknown>> }>;
  tools: Array<{ input_schema: { properties: Record<string, unknown>; required: string[] } }>;
} {
  expect(fetchMock).toHaveBeenCalled();
  const init = fetchMock.mock.calls[0]![1] as RequestInit;
  return JSON.parse(init.body as string) as {
    messages: Array<{ content: Array<Record<string, unknown>> }>;
    tools: Array<{ input_schema: { properties: Record<string, unknown>; required: string[] } }>;
  };
}

describe('AnthropicProvider — content block dispatch', () => {
  it('uses type: image with media_type=image/jpeg for JPEG inputs', async () => {
    const provider = new AnthropicProvider({ apiKey: 'k' });
    await provider.parse('AAA', ctx('image/jpeg'));
    const body = lastRequestBody();
    const first = body.messages[0]!.content[0]!;
    expect(first.type).toBe('image');
    expect(first.source).toMatchObject({
      type: 'base64',
      media_type: 'image/jpeg',
      data: 'AAA',
    });
  });

  it('uses type: image with media_type=image/png for PNG inputs', async () => {
    const provider = new AnthropicProvider({ apiKey: 'k' });
    await provider.parse('BBB', ctx('image/png'));
    const body = lastRequestBody();
    const first = body.messages[0]!.content[0]!;
    expect(first.type).toBe('image');
    expect((first.source as { media_type: string }).media_type).toBe('image/png');
  });

  it('uses type: document with media_type=application/pdf for PDF inputs', async () => {
    const provider = new AnthropicProvider({ apiKey: 'k' });
    await provider.parse('PDF-BYTES', ctx('application/pdf'));
    const body = lastRequestBody();
    const first = body.messages[0]!.content[0]!;
    expect(first.type).toBe('document');
    expect(first.source).toMatchObject({
      type: 'base64',
      media_type: 'application/pdf',
      data: 'PDF-BYTES',
    });
  });

  it('keeps the text prompt as the second content block in all cases', async () => {
    const provider = new AnthropicProvider({ apiKey: 'k' });
    await provider.parse('AAA', ctx('application/pdf'));
    const body = lastRequestBody();
    expect(body.messages[0]!.content[1]!.type).toBe('text');
  });

  it('constrains bulk arithmetic repair to re-read item rows only', async () => {
    const provider = new AnthropicProvider({ apiKey: 'k' });
    await provider.repairBulkItems('PDF-BYTES', ctx('application/pdf'), {
      expectedTotalOrig: 101.18,
      previousComputedTotal: 91.55,
      previousItems: [{ product_name: 'CC Li/Ze 6x1.25l', qty: 6, unit_price_orig: 0.25 }],
    });

    const body = lastRequestBody();
    expect(Object.keys(body.tools[0]!.input_schema.properties)).toEqual(['items']);
    expect(body.tools[0]!.input_schema.required).toEqual(['items']);
    const prompt = String(body.messages[0]!.content[1]!.text);
    expect(prompt).toContain('trusted printed final total is 101.18');
    expect(prompt).toContain('Pack-size text such as 6x1.25l');
    expect(prompt).toContain('does not replace the merchandise price');
    expect(prompt).toContain('VAT class, not an item quantity');
    expect(prompt).toContain('Count every separately printed repeated row');
    expect(prompt).toContain('Never invent an adjustment');
  });
});
