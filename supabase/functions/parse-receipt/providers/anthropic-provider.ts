import { buildPrompt, buildSchema } from '../prompts/receipt-prompt.ts';
import { buildBulkPromptForMode, buildBulkSchema } from '../prompts/bulk-import-prompt.ts';
import type {
  AiCallResult,
  AiCallTrace,
  AiContext,
  BulkParseMode,
  BulkParsedDocument,
  ParsedReceipt,
} from '../types.ts';
import { AiProviderError, type IAiProvider } from './ai-provider.ts';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-5';
const ANTHROPIC_VERSION = '2023-06-01';
const INTERACTIVE_MAX_TOKENS = 4096;
const BULK_MAX_TOKENS = 8192;
const TOOL_NAME = 'record_receipt';
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const BULK_REQUEST_TIMEOUT_MS = 75_000;

type Config = {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  bulkMaxTokens?: number;
};

export class AnthropicProvider implements IAiProvider {
  readonly name = 'anthropic';

  constructor(private readonly cfg: Config) {}

  async parse(imageBase64: string, ctx: AiContext): Promise<ParsedReceipt> {
    return (
      await this.request<ParsedReceipt>(
        imageBase64,
        ctx,
        buildPrompt(ctx),
        buildSchema(ctx),
        INTERACTIVE_MAX_TOKENS,
        this.cfg.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      )
    ).value;
  }

  async parseBulk(
    imageBase64: string,
    ctx: AiContext,
    forceReceipt = false,
  ): Promise<BulkParsedDocument> {
    return (await this.parseBulkDetailed(imageBase64, ctx, forceReceipt)).value;
  }

  parseBulkDetailed(
    imageBase64: string,
    ctx: AiContext,
    forceReceipt = false,
    mode: BulkParseMode = 'standard',
  ): Promise<AiCallResult<BulkParsedDocument>> {
    return this.request<BulkParsedDocument>(
      imageBase64,
      ctx,
      buildBulkPromptForMode(ctx, forceReceipt, mode),
      buildBulkSchema(ctx),
      this.cfg.bulkMaxTokens ?? BULK_MAX_TOKENS,
      this.cfg.timeoutMs ?? BULK_REQUEST_TIMEOUT_MS,
    );
  }

  private async request<T>(
    imageBase64: string,
    ctx: AiContext,
    prompt: string,
    schema: Record<string, unknown>,
    maxTokens: number,
    timeoutMs: number,
  ): Promise<AiCallResult<T>> {
    const isPdf = ctx.mimeType === 'application/pdf';
    const mediaBlock = isPdf
      ? {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: imageBase64 },
        }
      : {
          type: 'image',
          source: { type: 'base64', media_type: ctx.mimeType, data: imageBase64 },
        };
    const model = this.cfg.model ?? DEFAULT_MODEL;
    const baseTrace: AiCallTrace = { provider: 'anthropic', model };
    const body = {
      model,
      max_tokens: maxTokens,
      // Sonnet 5 enables adaptive thinking by default. Receipt extraction needs
      // the output budget for the forced structured result, so preserve the
      // previous no-thinking behavior explicitly. Sampling parameters are not
      // accepted by Sonnet 5 and are intentionally omitted.
      thinking: { type: 'disabled' },
      tools: [
        {
          name: TOOL_NAME,
          description: 'Record the parsed receipt fields, row evidence and line items.',
          input_schema: schema,
        },
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME, disable_parallel_tool_use: true },
      messages: [
        {
          role: 'user',
          content: [mediaBlock, { type: 'text', text: prompt }],
        },
      ],
    };

    let res: Response;
    try {
      res = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.cfg.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = isTimeoutError(error);
      throw new AiProviderError(
        timedOut ? 'timeout' : 'network_error',
        timedOut ? 'Anthropic API request timed out.' : 'Anthropic API network request failed.',
        baseTrace,
      );
    }
    const requestId = res.headers.get('request-id') ?? res.headers.get('x-request-id') ?? undefined;
    const responseTrace = { ...baseTrace, requestId };

    if (!res.ok) {
      throw new AiProviderError(
        `http_${String(res.status)}`,
        `Anthropic API request failed with status ${String(res.status)}.`,
        responseTrace,
      );
    }

    const wrapper: unknown = await res.json();
    const trace = traceFromResponse(wrapper, responseTrace);
    if (trace.stopReason !== 'tool_use') {
      throw new AiProviderError(
        'incomplete_response',
        `Anthropic response stopped with ${trace.stopReason ?? 'an unknown reason'}.`,
        trace,
      );
    }
    const input = extractToolInput(wrapper);
    if (!input) {
      throw new AiProviderError(
        'missing_output',
        'Anthropic returned no receipt tool output.',
        trace,
      );
    }
    return { value: input as T, trace };
  }
}

function traceFromResponse(wrapper: unknown, base: AiCallTrace): AiCallTrace {
  if (!wrapper || typeof wrapper !== 'object') return base;
  const value = wrapper as {
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  return {
    ...base,
    stopReason: value.stop_reason,
    inputTokens: value.usage?.input_tokens,
    outputTokens: value.usage?.output_tokens,
  };
}

function extractToolInput(wrapper: unknown): Record<string, unknown> | null {
  if (!wrapper || typeof wrapper !== 'object') return null;
  const blocks = (wrapper as { content?: unknown[] }).content;
  if (!Array.isArray(blocks)) return null;
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const value = block as { type?: unknown; name?: unknown; input?: unknown };
    if (
      value.type === 'tool_use' &&
      value.name === TOOL_NAME &&
      value.input &&
      typeof value.input === 'object'
    ) {
      return value.input as Record<string, unknown>;
    }
  }
  return null;
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name);
}
