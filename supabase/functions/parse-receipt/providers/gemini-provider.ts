import { buildPrompt, buildSchema } from '../prompts/receipt-prompt.ts';
import { buildBulkPrompt, buildBulkSchema } from '../prompts/bulk-import-prompt.ts';
import type {
  AiCallResult,
  AiCallTrace,
  AiContext,
  BulkParsedDocument,
  ParsedReceipt,
} from '../types.ts';
import { AiProviderError, type IAiProvider } from './ai-provider.ts';

const GEMINI_API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-3.7-flash';
const INTERACTIVE_THINKING_LEVEL = 'low';
const BULK_THINKING_LEVEL = 'high';
const IMAGE_MEDIA_RESOLUTION = 'MEDIA_RESOLUTION_HIGH';
const INTERACTIVE_PDF_MEDIA_RESOLUTION = 'MEDIA_RESOLUTION_MEDIUM';
const BULK_PDF_MEDIA_RESOLUTION = 'MEDIA_RESOLUTION_HIGH';
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

type Config = { apiKey: string; model?: string; timeoutMs?: number };

type RequestOptions = {
  thinkingLevel: string;
  mediaResolution: string;
};

export class GeminiProvider implements IAiProvider {
  readonly name = 'gemini';

  constructor(private readonly cfg: Config) {}

  async parse(imageBase64: string, ctx: AiContext): Promise<ParsedReceipt> {
    const result = await this.request<ParsedReceipt>(
      imageBase64,
      ctx,
      buildPrompt(ctx),
      buildSchema(ctx),
      {
        thinkingLevel: INTERACTIVE_THINKING_LEVEL,
        mediaResolution:
          ctx.mimeType === 'application/pdf'
            ? INTERACTIVE_PDF_MEDIA_RESOLUTION
            : IMAGE_MEDIA_RESOLUTION,
      },
    );
    return result.value;
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
  ): Promise<AiCallResult<BulkParsedDocument>> {
    return this.request<BulkParsedDocument>(
      imageBase64,
      ctx,
      buildBulkPrompt(ctx, forceReceipt),
      buildBulkSchema(ctx),
      {
        thinkingLevel: BULK_THINKING_LEVEL,
        mediaResolution:
          ctx.mimeType === 'application/pdf' ? BULK_PDF_MEDIA_RESOLUTION : IMAGE_MEDIA_RESOLUTION,
      },
    );
  }

  private async request<T>(
    imageBase64: string,
    ctx: AiContext,
    prompt: string,
    schema: Record<string, unknown>,
    options: RequestOptions,
  ): Promise<AiCallResult<T>> {
    const model = this.cfg.model ?? DEFAULT_MODEL;
    const url = `${GEMINI_API_URL_BASE}/${model}:generateContent`;
    const baseTrace: AiCallTrace = {
      provider: 'gemini',
      model,
      thinkingLevel: options.thinkingLevel,
      mediaResolution: options.mediaResolution,
    };
    const body = {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inline_data: { mime_type: ctx.mimeType, data: imageBase64 },
              media_resolution: { level: options.mediaResolution },
            },
          ],
        },
      ],
      generationConfig: {
        thinkingConfig: { thinkingLevel: options.thinkingLevel },
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
      },
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.cfg.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = isTimeoutError(error);
      throw new AiProviderError(
        timedOut ? 'timeout' : 'network_error',
        timedOut ? 'Gemini API request timed out.' : 'Gemini API network request failed.',
        baseTrace,
      );
    }
    const requestId =
      res.headers.get('x-request-id') ?? res.headers.get('x-goog-request-id') ?? undefined;
    const responseTrace = { ...baseTrace, requestId };

    if (!res.ok) {
      throw new AiProviderError(
        `http_${String(res.status)}`,
        `Gemini API request failed with status ${String(res.status)}.`,
        responseTrace,
      );
    }

    const wrapper: unknown = await res.json();
    const candidate = firstCandidate(wrapper);
    const trace = traceFromResponse(wrapper, candidate, responseTrace);
    if (candidate.finishReason !== 'STOP') {
      throw new AiProviderError(
        'incomplete_response',
        `Gemini response stopped with ${candidate.finishReason ?? 'an unknown reason'}.`,
        trace,
      );
    }
    const text = extractText(candidate);
    if (!text) {
      throw new AiProviderError('missing_output', 'Gemini returned no structured output.', trace);
    }
    try {
      return { value: JSON.parse(text) as T, trace };
    } catch {
      throw new AiProviderError('invalid_json', 'Gemini returned invalid JSON.', trace);
    }
  }
}

type GeminiCandidate = {
  finishReason?: string;
  content?: { parts?: unknown[] };
};

function firstCandidate(wrapper: unknown): GeminiCandidate {
  if (!wrapper || typeof wrapper !== 'object') return {};
  const candidates = (wrapper as { candidates?: unknown[] }).candidates;
  const first = candidates?.[0];
  return first && typeof first === 'object' ? (first as GeminiCandidate) : {};
}

function traceFromResponse(
  wrapper: unknown,
  candidate: GeminiCandidate,
  base: AiCallTrace,
): AiCallTrace {
  const usage =
    wrapper && typeof wrapper === 'object'
      ? (
          wrapper as {
            usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
          }
        ).usageMetadata
      : undefined;
  return {
    ...base,
    stopReason: candidate.finishReason,
    inputTokens: usage?.promptTokenCount,
    outputTokens: usage?.candidatesTokenCount,
  };
}

function extractText(candidate: GeminiCandidate): string | null {
  const parts = candidate.content?.parts;
  if (!parts) return null;
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const value = part as { text?: unknown; thought?: unknown };
    if (value.thought === true) continue;
    if (typeof value.text === 'string') return value.text;
  }
  return null;
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name);
}
