import { describe, expect, it, vi, beforeEach } from 'vitest';
import { edgeFunctionParseReceiptService } from './edge-fn-parse-receipt';

type InvokeArgs = [string, { body: Record<string, unknown> }];
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
    });
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
});
