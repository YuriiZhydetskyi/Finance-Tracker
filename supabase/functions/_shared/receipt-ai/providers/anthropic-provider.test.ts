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

type RequestBody = {
  model: string;
  max_tokens: number;
  temperature?: number;
  thinking: Record<string, unknown>;
  output_config: { effort: string };
  tool_choice: Record<string, unknown>;
  messages: Array<{ content: Array<Record<string, unknown>> }>;
  tools: Array<{
    name: string;
    strict?: boolean;
    input_schema: { properties: Record<string, unknown>; required: string[] };
  }>;
};

function lastRequestBody(): RequestBody {
  expect(fetchMock).toHaveBeenCalled();
  const init = fetchMock.mock.calls[0]![1] as RequestInit;
  return JSON.parse(init.body as string) as RequestBody;
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
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

  it('sends an email body as a plain-text document with the email rules in the prompt', async () => {
    const provider = new AnthropicProvider({ apiKey: 'k' });
    await provider.parseBulkDetailed(btoa('Gesamtbetrag EUR 15,98'), ctx('text/plain'));
    const body = lastRequestBody();
    const [first, prompt] = body.messages[0]!.content;
    expect(first).toMatchObject({
      type: 'document',
      source: { type: 'text', media_type: 'text/plain', data: 'Gesamtbetrag EUR 15,98' },
    });
    expect((prompt as { text: string }).text).toContain('plain text of an email');
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
    expect(body.tools[0]!.input_schema.required).toEqual(
      expect.arrayContaining(['total_raw_text', 'article_count', 'article_count_raw_text']),
    );
    const items = body.tools[0]!.input_schema.properties.items as {
      items: { required: string[] };
    };
    expect(items.items.required).toEqual(
      expect.arrayContaining(['n', 'q', 'u', 'o', 'r', 'e', 't']),
    );
    const prompt = String(body.messages[0]!.content[1]!.text);
    expect(prompt).toContain('Count repeated identical rows separately');
    expect(prompt).toContain('means twelve separate X items');
    expect(prompt).toContain('once top-to-bottom and once bottom-to-top');
    expect(prompt).toContain('Never derive article_count');
    expect(prompt).toContain('make one more visual sweep');
    expect(prompt).toContain('not permission to force agreement');
    expect(prompt).toContain('tax_class');
    expect(prompt).toContain('n=product_name');
    expect(prompt).toContain('standalone multiplier line can be printed BETWEEN two product lines');
    expect(prompt).not.toContain('trusted printed final total');
    expect(prompt).not.toContain('Previous extraction');
    expect(result.trace).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      stopReason: 'tool_use',
      inputTokens: 140,
      outputTokens: 60,
    });
  });

  it('expands compact Anthropic item aliases before returning the canonical bulk result', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...sampleToolUse,
          content: [
            {
              type: 'tool_use',
              name: 'record_receipt',
              input: {
                document_kind: 'receipt',
                classification_reason: 'Receipt',
                store: 'EDEKA',
                date: '2026-07-01',
                currency: 'EUR',
                total_orig: 3.58,
                items: [
                  {
                    n: 'Milk',
                    p: null,
                    q: 2,
                    u: 1.79,
                    c: null,
                    d: 0,
                    o: 1,
                    r: '2 x 1,79 / Milk 3,58',
                    k: 'item',
                    e: 'explicit_multiplier',
                    l: 3.58,
                    t: '1',
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const provider = new AnthropicProvider({ apiKey: 'k' });

    const result = await provider.parseBulkDetailed('PDF', ctx('application/pdf'));

    expect(result.value.items).toEqual([
      expect.objectContaining({
        product_name: 'Milk',
        qty: 2,
        unit_price_orig: 1.79,
        source_ordinal: 1,
        qty_evidence: 'explicit_multiplier',
      }),
    ]);
  });

  it('requests and expands a bounded absolute-ordinal chunk', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...sampleToolUse,
          content: [
            {
              type: 'tool_use',
              name: 'record_receipt',
              input: {
                document_kind: 'receipt',
                classification_reason: 'Receipt',
                store: 'EDEKA',
                date: '2026-08-14',
                currency: 'EUR',
                total_orig: 100,
                chunk_start_ordinal: 39,
                has_more: true,
                items: [
                  {
                    n: 'Milk',
                    p: null,
                    q: 1,
                    u: 1,
                    c: null,
                    d: 0,
                    o: 39,
                    r: 'Milk 1,00',
                    k: 'item',
                    e: 'implicit_one',
                    l: 1,
                    t: null,
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const provider = new AnthropicProvider({ apiKey: 'k' });

    const result = await provider.parseBulkChunkDetailed(
      'PDF',
      ctx('application/pdf'),
      false,
      39,
      40,
    );

    const body = lastRequestBody();
    expect(body.tools[0]!.input_schema.required).toEqual(
      expect.arrayContaining(['chunk_start_ordinal', 'has_more']),
    );
    expect(String(body.messages[0]!.content[1]!.text)).toContain('source_ordinal 39 through 78');
    expect(result.value).toMatchObject({ chunk_start_ordinal: 39, has_more: true });
    expect(result.value.items[0]).toMatchObject({ product_name: 'Milk', source_ordinal: 39 });
  });

  it('uses a dedicated bidirectional physical-row audit for verification calls', async () => {
    const provider = new AnthropicProvider({ apiKey: 'k' });

    await provider.parseBulkDetailed('PDF-BYTES', ctx('application/pdf'), false, 'verification');

    const prompt = String(lastRequestBody().messages[0]!.content[1]!.text);
    expect(prompt).toContain('private physical-row ledger');
    expect(prompt).toContain('top-to-bottom and once bottom-to-top');
    expect(prompt).toContain('four X rows, then Y');
    expect(prompt).toContain('means twelve separate X items');
    expect(prompt).toContain('Never use the final total or arithmetic gap');
    expect(prompt).toContain('Separately inspect the receipt summary');
    expect(prompt).not.toContain('Previous extraction');
  });

  it('allows the worker to expand the bulk output budget without changing interactive parsing', async () => {
    const provider = new AnthropicProvider({ apiKey: 'k', bulkMaxTokens: 20_000 });

    await provider.parseBulkDetailed('PDF-BYTES', ctx('application/pdf'));

    expect(lastRequestBody().max_tokens).toBe(20_000);
  });

  it.each([
    ['interactive', (provider: AnthropicProvider) => provider.parse('AAA', ctx('image/jpeg'))],
    [
      'bulk',
      (provider: AnthropicProvider) => provider.parseBulkDetailed('PDF', ctx('application/pdf')),
    ],
  ])(
    'sends the Sonnet 5.5 request shape on the %s path: between_tools, explicit effort, auto tool choice',
    async (_path, call) => {
      const provider = new AnthropicProvider({ apiKey: 'k' });

      await call(provider);

      const body = lastRequestBody();
      expect(body.model).toBe('claude-sonnet-5-5');
      expect(body.thinking).toEqual({ type: 'between_tools' });
      expect(body.output_config).toEqual({ effort: 'high' });
      expect(body.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0]!.name).toBe('record_receipt');
      expect(body).not.toHaveProperty('temperature');
      expect(body).not.toHaveProperty('top_p');
      expect(body).not.toHaveProperty('top_k');
      const prompt = String(body.messages[0]!.content[1]!.text);
      expect(prompt).toContain('calling the record_receipt tool exactly once');
    },
  );

  it('does not mark the receipt tool strict because its schemas exceed strict-mode limits', async () => {
    const provider = new AnthropicProvider({ apiKey: 'k' });

    await provider.parseBulkDetailed('PDF', ctx('application/pdf'));

    expect(lastRequestBody().tools[0]).not.toHaveProperty('strict');
  });

  it('gives the interactive path the same output ceiling as a default bulk call', async () => {
    const provider = new AnthropicProvider({ apiKey: 'k' });

    await provider.parse('AAA', ctx('image/jpeg'));

    expect(lastRequestBody().max_tokens).toBe(8192);
  });

  it('skips thinking and progress-note blocks that precede the tool call', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...sampleToolUse,
        content: [
          { type: 'thinking', thinking: '', signature: 'sig' },
          { type: 'text', text: 'Reading the receipt now.' },
          ...sampleToolUse.content,
        ],
      }),
    );
    const provider = new AnthropicProvider({ apiKey: 'k' });

    await expect(provider.parse('AAA', ctx('image/jpeg'))).resolves.toMatchObject({
      store: 'Lidl',
      total_orig: 1.5,
    });
  });

  it('rejects a plain-text answer because auto tool choice does not guarantee a call', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        stop_reason: 'end_turn',
        usage: { input_tokens: 140, output_tokens: 20 },
        content: [{ type: 'text', text: 'The receipt total is 1.50 EUR.' }],
      }),
    );
    const provider = new AnthropicProvider({ apiKey: 'k' });

    await expect(provider.parse('AAA', ctx('image/jpeg'))).rejects.toMatchObject({
      code: 'missing_output',
      trace: expect.objectContaining({ provider: 'anthropic', stopReason: 'end_turn' }),
    });
  });

  it('rejects a tool_use stop that carries no record_receipt call', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...sampleToolUse,
        content: [{ type: 'tool_use', name: 'something_else', input: { store: 'Lidl' } }],
      }),
    );
    const provider = new AnthropicProvider({ apiKey: 'k' });

    await expect(provider.parse('AAA', ctx('image/jpeg'))).rejects.toMatchObject({
      code: 'missing_output',
    });
  });

  it('turns a safety refusal into a provider error instead of reading its content', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'general_harms', explanation: null },
        usage: { input_tokens: 140, output_tokens: 0 },
        content: [],
      }),
    );
    const provider = new AnthropicProvider({ apiKey: 'k' });

    await expect(provider.parseBulkDetailed('PDF', ctx('application/pdf'))).rejects.toMatchObject({
      code: 'incomplete_response',
      message: expect.stringContaining('general_harms'),
      trace: expect.objectContaining({ provider: 'anthropic', stopReason: 'refusal' }),
    });
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
      trace: expect.objectContaining({ provider: 'anthropic', model: 'claude-sonnet-5-5' }),
    });
  });
});
