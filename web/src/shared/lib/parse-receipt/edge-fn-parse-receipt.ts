// Calls the Supabase Edge Function `parse-receipt`. The function does the
// AI provider orchestration + allowlist check; the Zod validation is here on
// the client so a malformed AI response fails loudly with the canonical
// schema's error message.

import { FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';
import { ParsedReceiptSchema, type ParsedReceipt } from '@finance-tracker/domain';
import { supabase } from '../supabase-client';
import type { IParseReceiptService, ParseReceiptInput } from './parse-receipt.types';

const FUNCTION_NAME = 'parse-receipt';

// Supabase stops an Edge Function after 150 s of wall-clock time. Giving up a
// little earlier lets the user see a clear timeout message instead of an opaque
// gateway error. (docs/architecture.md still quotes an older 25 s figure.)
export const PARSE_TIMEOUT_MS = 140_000;

const MAX_BODY_MESSAGE_LENGTH = 500;

function stringProperty(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object' || !(key in value)) return null;
  const property = (value as Record<string, unknown>)[key];
  return typeof property === 'string' ? property : null;
}

function statusOf(response: unknown): number | null {
  if (!response || typeof response !== 'object' || !('status' in response)) return null;
  return typeof response.status === 'number' ? response.status : null;
}

// The function answers failures with `{ "error": "<reason>" }` (e.g. both AI
// providers failed); the client wrapper only says "non-2xx", so read the body.
async function readResponseMessage(response: unknown): Promise<string | null> {
  if (!response || typeof response !== 'object' || !('text' in response)) return null;
  if (typeof response.text !== 'function') return null;
  try {
    const text = (await (response as Response).text()).trim();
    if (!text) return null;
    try {
      const body: unknown = JSON.parse(text);
      return stringProperty(body, 'error') ?? stringProperty(body, 'message');
    } catch {
      return text.slice(0, MAX_BODY_MESSAGE_LENGTH);
    }
  } catch {
    return null;
  }
}

async function describeInvokeError(
  error: unknown,
  signal: AbortSignal | undefined,
): Promise<string> {
  if (error instanceof FunctionsHttpError || error instanceof FunctionsRelayError) {
    const status = statusOf(error.context);
    const serverMessage = await readResponseMessage(error.context);
    const reason = serverMessage ?? stringProperty(error, 'message') ?? 'unknown error';
    return status === null ? reason : `HTTP ${String(status)}: ${reason}`;
  }
  const cause = (error as { context?: unknown } | null)?.context;
  const causeName = stringProperty(cause, 'name');
  if (causeName === 'AbortError' || causeName === 'TimeoutError') {
    return signal?.aborted
      ? 'request was cancelled'
      : `timed out after ${String(PARSE_TIMEOUT_MS / 1000)} s`;
  }
  return stringProperty(error, 'message') ?? 'unknown error';
}

export const edgeFunctionParseReceiptService: IParseReceiptService = {
  async parse(input: ParseReceiptInput): Promise<ParsedReceipt> {
    const response = await supabase.functions.invoke<unknown>(FUNCTION_NAME, {
      body: {
        imageBase64: input.imageBase64,
        mimeType: input.mimeType ?? 'image/jpeg',
        categories: input.categories,
        products: input.products ?? [],
      },
      timeout: PARSE_TIMEOUT_MS,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (response.error) {
      const message = await describeInvokeError(response.error, input.signal);
      throw new Error(`parse-receipt failed: ${message}`, { cause: response.error });
    }
    const parsed = ParsedReceiptSchema.safeParse(response.data);
    if (!parsed.success) {
      throw new Error('parse-receipt returned invalid shape', { cause: parsed.error });
    }
    return parsed.data;
  },
};
