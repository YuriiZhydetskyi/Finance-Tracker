import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from './anthropic-provider.ts';
import type { AiContext } from '../types.ts';

const sampleToolUse = {
  stop_reason: 'tool_use',
  usage: { input_tokens: 140, output_tokens: 60 },
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
  max_tokens: number;
  temperature?: number;
  messages: Array<{ content: Array<Record<string, unknown>> }>;
  tools: Array<{ input_schema: { properties: Record<string, unknown>; required: string[] } }>;
} {
  expect(fetchMock).toHaveBeenCalled();
  const init = fetchMock.mock.calls[0]![1] as RequestInit;
  return JSON.parse(init.body as string) as {
    max_tokens: number;
    temperature?: number;
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

  it('performs a blind full-document bulk parse with evidence and a larger output budget', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const provider = new AnthropicProvider({ apiKey: 'k' });
    const result = await provider.parseBulkDetailed('PDF-BYTES', ctx('application/pdf'));

    const body = lastRequestBody();
    expect(body.max_tokens).toBe(8192);
    expect(timeoutSpy).toHaveBeenCalledWith(75_000);
    timeoutSpy.mockRestore();
    expect(body.tools[0]!.input_schema.required).toContain('total_raw_text');
    const items = body.tools[0]!.input_schema.properties.items as {
      items: { required: string[] };
    };
    expect(items.items.required).toEqual(
      expect.arrayContaining(['source_ordinal', 'raw_text', 'qty_evidence', 'tax_class']),
    );
    const prompt = String(body.messages[0]!.content[1]!.text);
    expect(prompt).toContain('Count repeated identical rows separately');
    expect(prompt).toContain('make one more visual sweep');
    expect(prompt).toContain('not permission to force agreement');
    expect(prompt).toContain('tax_class');
    expect(prompt).not.toContain('trusted printed final total');
    expect(prompt).not.toContain('Previous extraction');
    expect(result.trace).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      stopReason: 'tool_use',
      inputTokens: 140,
      outputTokens: 60,
    });
  });

  it('allows the worker to expand the bulk output budget without changing interactive parsing', async () => {
    const provider = new AnthropicProvider({ apiKey: 'k', bulkMaxTokens: 16_384 });

    await provider.parseBulkDetailed('PDF-BYTES', ctx('application/pdf'));

    expect(lastRequestBody().max_tokens).toBe(16_384);
  });

  it('omits custom temperature for Opus 4.7 verification requests', async () => {
    const provider = new AnthropicProvider({
      apiKey: 'k',
      model: 'claude-opus-4-7',
      temperature: null,
    });

    await provider.parseBulkDetailed('PDF-BYTES', ctx('application/pdf'));

    expect(lastRequestBody()).not.toHaveProperty('temperature');
  });

  it('rejects max_tokens responses so truncated item arrays cannot be accepted', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ...sampleToolUse, stop_reason: 'max_tokens' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const provider = new AnthropicProvider({ apiKey: 'k' });

    await expect(provider.parseBulkDetailed('PDF', ctx('application/pdf'))).rejects.toMatchObject({
      code: 'incomplete_response',
      trace: expect.objectContaining({ stopReason: 'max_tokens' }),
    });
  });

  it('records provider and model when the bulk request times out', async () => {
    const timeout = Object.assign(new Error('request aborted'), { name: 'TimeoutError' });
    fetchMock.mockRejectedValueOnce(timeout);
    const provider = new AnthropicProvider({ apiKey: 'k' });

    await expect(provider.parseBulkDetailed('PDF', ctx('application/pdf'))).rejects.toMatchObject({
      code: 'timeout',
      trace: expect.objectContaining({ provider: 'anthropic', model: 'claude-sonnet-4-6' }),
    });
  });
});
