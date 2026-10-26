import { buildPrompt, buildSchema } from '../prompts/receipt-prompt.ts';
import { buildBulkChunkPrompt, buildBulkPromptForMode } from '../prompts/bulk-import-prompt.ts';
import {
  buildCompactBulkChunkSchema,
  buildCompactBulkSchema,
  COMPACT_ITEM_FIELD_INSTRUCTIONS,
  expandCompactBulkChunk,
  expandCompactBulkDocument,
} from '../prompts/bulk-import-wire.ts';
import type {
  AiCallResult,
  AiCallTrace,
  AiContext,
  BulkParseMode,
  BulkParsedDocument,
  BulkReceiptChunk,
  ParsedReceipt,
} from '../types.ts';
import { decodeTextDocument, isTextDocument, TEXT_DOCUMENT_MIME } from '../text-document.ts';
import { AiProviderError, type IAiProvider } from './ai-provider.ts';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-5-5';
const ANTHROPIC_VERSION = '2023-06-01';
const INTERACTIVE_MAX_TOKENS = 8192;
const BULK_MAX_TOKENS = 8192;
const TOOL_NAME = 'record_receipt';
const TOOL_INSTRUCTION = `Return the result only by calling the ${TOOL_NAME} tool exactly once with the complete data. Do not answer in plain text.`;
const EFFORT = 'high';
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
    return this.request(
      imageBase64,
      ctx,
      `${buildBulkPromptForMode(ctx, forceReceipt, mode)}\n\n${COMPACT_ITEM_FIELD_INSTRUCTIONS}`,
      buildCompactBulkSchema(ctx),
      this.cfg.bulkMaxTokens ?? BULK_MAX_TOKENS,
      this.cfg.timeoutMs ?? BULK_REQUEST_TIMEOUT_MS,
      expandCompactBulkDocument,
    );
  }

  parseBulkChunkDetailed(
    imageBase64: string,
    ctx: AiContext,
    forceReceipt: boolean,
    startOrdinal: number,
    maxItems: number,
  ): Promise<AiCallResult<BulkReceiptChunk>> {
    return this.request(
      imageBase64,
      ctx,
      `${buildBulkChunkPrompt(ctx, forceReceipt, startOrdinal, maxItems)}\n\n${COMPACT_ITEM_FIELD_INSTRUCTIONS}`,
      buildCompactBulkChunkSchema(ctx),
      this.cfg.bulkMaxTokens ?? BULK_MAX_TOKENS,
      this.cfg.timeoutMs ?? BULK_REQUEST_TIMEOUT_MS,
      expandCompactBulkChunk,
    );
  }

  private async request<T>(
    imageBase64: string,
    ctx: AiContext,
    prompt: string,
    schema: Record<string, unknown>,
    maxTokens: number,
    timeoutMs: number,
    normalize: (value: unknown) => T = (value) => value as T,
  ): Promise<AiCallResult<T>> {
    const isPdf = ctx.mimeType === 'application/pdf';
    const mediaBlock = isTextDocument(ctx.mimeType)
      ? {
          type: 'document',
          source: {
            type: 'text',
            media_type: TEXT_DOCUMENT_MIME,
            data: decodeTextDocument(imageBase64),
          },
        }
      : isPdf
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
      // Sonnet 5.5 answers 400 to `thinking: disabled` and to a forced
      // tool_choice, and to any non-default sampling parameter (omitted on
      // purpose). `between_tools` is its thinking-off setting (effort must be
      // `high` or lower), so the output budget stays with the structured
      // result. The tool call is steered by TOOL_INSTRUCTION under `auto`;
      // `strict` is absent because the receipt schemas exceed its limits (16
      // union-typed fields, `minimum`, no `additionalProperties: false`), and
      // a missing tool_use block is rejected below instead.
      thinking: { type: 'between_tools' },
      output_config: { effort: EFFORT },
      tools: [
        {
          name: TOOL_NAME,
          description: 'Record the parsed receipt fields, row evidence and line items.',
          input_schema: schema,
        },
      ],
      tool_choice: { type: 'auto', disable_parallel_tool_use: true },
      messages: [
        {
          role: 'user',
          content: [mediaBlock, { type: 'text', text: `${prompt}\n\n${TOOL_INSTRUCTION}` }],
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
    if (trace.stopReason === 'refusal') {
      const category = refusalCategory(wrapper);
      throw new AiProviderError(
        'incomplete_response',
        `Anthropic declined the request${category ? ` (${category})` : ''}.`,
        trace,
      );
    }
    if (trace.stopReason === 'end_turn') {
      throw new AiProviderError(
        'missing_output',
        'Anthropic answered without calling the receipt tool.',
        trace,
      );
    }
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
    return { value: normalize(input), trace };
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

function refusalCategory(wrapper: unknown): string | null {
  if (!wrapper || typeof wrapper !== 'object') return null;
  const details = (wrapper as { stop_details?: { category?: unknown } | null }).stop_details;
  return typeof details?.category === 'string' ? details.category : null;
}

// Thinking and progress-note blocks precede the tool call, so match by type
// and name rather than position.
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
